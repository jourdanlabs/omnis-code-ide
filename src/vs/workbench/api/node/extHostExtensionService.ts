/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as performance from '../../../base/common/performance.js';
import type * as vscode from 'vscode';
import { createApiFactoryAndRegisterActors } from '../common/extHost.api.impl.js';
import { INodeModuleFactory, RequireInterceptor } from '../common/extHostRequireInterceptor.js';
import { ExtensionActivationTimesBuilder } from '../common/extHostExtensionActivator.js';
import { connectProxyResolver } from './proxyResolver.js';
import { AbstractExtHostExtensionService } from '../common/extHostExtensionService.js';
import { ExtHostDownloadService } from './extHostDownloadService.js';
import { URI } from '../../../base/common/uri.js';
import { Schemas } from '../../../base/common/network.js';
import { IExtensionDescription } from '../../../platform/extensions/common/extensions.js';
import { ExtensionRuntime } from '../common/extHostTypes.js';
import { CLIServer } from './extHostCLIServer.js';
import { realpathSync } from '../../../base/node/pfs.js';
import { ExtHostConsoleForwarder } from './extHostConsoleForwarder.js';
import { ExtHostDiskFileSystemProvider } from './extHostDiskFileSystemProvider.js';
import nodeModule from 'node:module';
import { assertType } from '../../../base/common/types.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { BidirectionalMap } from '../../../base/common/map.js';
import { DisposableStore, toDisposable } from '../../../base/common/lifecycle.js';
import { createGatedFs, createGatedFsPromises, gatedFsGlobalKey, gatedFsPromisesGlobalKey, publishGatedGlobals, shouldGateParent } from './omnisWriteGate.js';
const require = nodeModule.createRequire(import.meta.url);

/** App root for shouldGateParent — set before extensions activate. */
let omnisAppRoot: string | undefined;

/** Unpatched Module._load — captured when the interceptor installs. */
let rawNodeModuleLoad: ((request: string, parent: any, isMain: boolean) => any) | undefined;

function loadRawBuiltin(request: string): any {
	const parent = { filename: URI.parse(import.meta.url).fsPath || import.meta.url };
	if (!rawNodeModuleLoad) {
		// Fallback: createRequire of this file (may already be patched).
		return require(request);
	}
	return rawNodeModuleLoad(request, parent, false);
}

function ensureGatedModules(): { fs: any; fsp: any } {
	const g = globalThis as any;
	if (!g[gatedFsGlobalKey()]) {
		const rawFs = loadRawBuiltin('fs');
		const gatedFs = createGatedFs(rawFs);
		const gatedFsp = createGatedFsPromises(rawFs.promises ?? loadRawBuiltin('fs/promises'));
		publishGatedGlobals(gatedFs, gatedFsp);
	}
	return { fs: g[gatedFsGlobalKey()], fsp: g[gatedFsPromisesGlobalKey()] };
}

/**
 * OMNIS CODE: wrap extension-visible `fs` / `node:fs` so mutating calls consult omnis-key.
 * Read path is untouched. Built-in product code is not gated (see shouldGateParent).
 */
class OmnisFsModuleFactory implements INodeModuleFactory {
	public readonly nodeModuleName = ['fs', 'node:fs'];

	private _raw: any | undefined;

	load(_request: string, parent: URI, original: (request: string) => any): any {
		if (!this._raw) {
			this._raw = original('fs');
		}
		if (!shouldGateParent(parent, omnisAppRoot)) {
			return this._raw;
		}
		ensureGatedModules();
		return (globalThis as any)[gatedFsGlobalKey()];
	}
}

class OmnisFsPromisesModuleFactory implements INodeModuleFactory {
	public readonly nodeModuleName = ['fs/promises', 'node:fs/promises'];

	private _raw: any | undefined;

	load(_request: string, parent: URI, original: (request: string) => any): any {
		if (!this._raw) {
			this._raw = original('fs/promises');
		}
		if (!shouldGateParent(parent, omnisAppRoot)) {
			return this._raw;
		}
		ensureGatedModules();
		return (globalThis as any)[gatedFsPromisesGlobalKey()];
	}
}

class NodeModuleRequireInterceptor extends RequireInterceptor {

	private static _createDataUri(scriptContent: string): string {
		return `data:text/javascript;base64,${Buffer.from(scriptContent).toString('base64')}`;
	}

	private static _vscodeImportFnName = `_VSCODE_IMPORT_VSCODE_API`;

	private readonly _store = new DisposableStore();

	dispose(): void {
		this._store.dispose();
	}

	protected _installInterceptor(): void {
		const that = this;
		const node_module = require('module');
		const originalLoad = node_module._load;
		rawNodeModuleLoad = originalLoad;
		node_module._load = function load(request: string, parent: { filename: string }, isMain: boolean) {
			request = applyAlternatives(request);
			if (!that._factories.has(request)) {
				return originalLoad.apply(this, arguments);
			}
			return that._factories.get(request)!.load(
				request,
				URI.file(realpathSync(parent.filename)),
				request => originalLoad.apply(this, [request, parent, isMain])
			);
		};

		const originalLookup = node_module._resolveLookupPaths;
		node_module._resolveLookupPaths = (request: string, parent: unknown) => {
			return originalLookup.call(this, applyAlternatives(request), parent);
		};

		const originalResolveFilename = node_module._resolveFilename;
		node_module._resolveFilename = function resolveFilename(request: string, parent: unknown, isMain: boolean, options?: { paths?: string[] }) {
			if (request === 'vsda' && Array.isArray(options?.paths) && options.paths.length === 0) {
				// ESM: ever since we moved to ESM, `require.main` will be `undefined` for extensions
				// Some extensions have been using `require.resolve('vsda', { paths: require.main.paths })`
				// to find the `vsda` module in our app root. To be backwards compatible with this pattern,
				// we help by filling in the `paths` array with the node modules paths of the current module.
				options.paths = node_module._nodeModulePaths(import.meta.dirname);
			}
			return originalResolveFilename.call(this, request, parent, isMain, options);
		};

		const applyAlternatives = (request: string) => {
			for (const alternativeModuleName of that._alternatives) {
				const alternative = alternativeModuleName(request);
				if (alternative) {
					request = alternative;
					break;
				}
			}
			return request;
		};

		const apiInstances = new BidirectionalMap<typeof vscode, string>();
		const apiImportDataUrl = new Map<string, string>();

		// define a global function that can be used to get API instances given a random key
		Object.defineProperty(globalThis, NodeModuleRequireInterceptor._vscodeImportFnName, {
			enumerable: false,
			configurable: false,
			writable: false,
			value: (key: string) => {
				return apiInstances.getKey(key);
			}
		});

		let apiModuleFactory: INodeModuleFactory | undefined;

		const lookup = (url: string): string => {
			// Get the vscode-module factory - which is the same logic that's also used by
			// the CommonJS require interceptor
			if (!apiModuleFactory) {
				apiModuleFactory = this._factories.get('vscode');
				assertType(apiModuleFactory);
			}

			const uri = URI.parse(url);

			// Get or create the API instance. The interface is per extension and extensions are
			// looked up by the uri (e.data.url) and path containment.
			const apiInstance = apiModuleFactory.load('_not_used', uri, () => { throw new Error('CANNOT LOAD MODULE from here.'); });
			let key = apiInstances.get(apiInstance);
			if (!key) {
				key = generateUuid();
				apiInstances.set(apiInstance, key);
			}

			// Create and cache a data-url which is the import script for the API instance
			let scriptDataUrlSrc = apiImportDataUrl.get(key);
			if (!scriptDataUrlSrc) {
				const jsCode = `const _vscodeInstance = globalThis.${NodeModuleRequireInterceptor._vscodeImportFnName}('${key}');\n\n${Object.keys(apiInstance).map((name => `export const ${name} = _vscodeInstance['${name}'];`)).join('\n')}`;
				scriptDataUrlSrc = NodeModuleRequireInterceptor._createDataUri(jsCode);
				apiImportDataUrl.set(key, scriptDataUrlSrc);
			}
			return scriptDataUrlSrc;
		};
		// OMNIS CODE: ESM `import … from 'fs'` for gated parents only.
		// Native builtins have no editable source; short-circuit to a data-URL
		// shim that re-exports the gated instance published on globalThis.
		const fsShimUrl = NodeModuleRequireInterceptor._createDataUri(`
const fs = globalThis[Symbol.for('omnis.code.gated.fs')];
if (!fs) throw new Error('OMNIS write gate: gated fs not initialized');
export default fs;
export const writeFile = (...a) => fs.writeFile(...a);
export const writeFileSync = (...a) => fs.writeFileSync(...a);
export const appendFile = (...a) => fs.appendFile(...a);
export const appendFileSync = (...a) => fs.appendFileSync(...a);
export const rm = (...a) => fs.rm(...a);
export const rmSync = (...a) => fs.rmSync(...a);
export const unlink = (...a) => fs.unlink(...a);
export const unlinkSync = (...a) => fs.unlinkSync(...a);
export const rename = (...a) => fs.rename(...a);
export const renameSync = (...a) => fs.renameSync(...a);
export const mkdir = (...a) => fs.mkdir(...a);
export const mkdirSync = (...a) => fs.mkdirSync(...a);
export const createWriteStream = (...a) => fs.createWriteStream(...a);
export const copyFile = (...a) => fs.copyFile(...a);
export const copyFileSync = (...a) => fs.copyFileSync(...a);
export const cp = (...a) => fs.cp(...a);
export const cpSync = (...a) => fs.cpSync(...a);
export const readFile = (...a) => fs.readFile(...a);
export const readFileSync = (...a) => fs.readFileSync(...a);
export const promises = fs.promises;
export const constants = fs.constants;
`);
		const fspShimUrl = NodeModuleRequireInterceptor._createDataUri(`
const fsp = globalThis[Symbol.for('omnis.code.gated.fs.promises')];
if (!fsp) throw new Error('OMNIS write gate: gated fs/promises not initialized');
export default fsp;
export const writeFile = (...a) => fsp.writeFile(...a);
export const appendFile = (...a) => fsp.appendFile(...a);
export const rm = (...a) => fsp.rm(...a);
export const unlink = (...a) => fsp.unlink(...a);
export const rename = (...a) => fsp.rename(...a);
export const mkdir = (...a) => fsp.mkdir(...a);
export const copyFile = (...a) => fsp.copyFile(...a);
export const cp = (...a) => fsp.cp(...a);
export const readFile = (...a) => fsp.readFile(...a);
`);

		const hooks = nodeModule.registerHooks({
			resolve: (specifier, context, nextResolve) => {
				if (specifier === 'vscode' && context.parentURL) {
					const otherUrl = lookup(context.parentURL);
					return {
						url: otherUrl,
						shortCircuit: true,
					};
				}
				// OMNIS CODE write gate — ESM path (gated parents only)
				if (
					(specifier === 'fs' || specifier === 'node:fs' ||
						specifier === 'fs/promises' || specifier === 'node:fs/promises')
					&& context.parentURL
				) {
					try {
						const parentUri = URI.parse(context.parentURL);
						if (parentUri.scheme === 'file' && shouldGateParent(parentUri, omnisAppRoot)) {
							ensureGatedModules();
							if (specifier === 'fs' || specifier === 'node:fs') {
								return { url: fsShimUrl, shortCircuit: true };
							}
							return { url: fspShimUrl, shortCircuit: true };
						}
					} catch {
						// Fall through to default resolution on any parse/gate error.
					}
				}
				return nextResolve(specifier, context);
			},
		});
		this._store.add(toDisposable(() => hooks.deregister()));
	}
}

export class ExtHostExtensionService extends AbstractExtHostExtensionService {

	readonly extensionRuntime = ExtensionRuntime.Node;

	protected async _beforeAlmostReadyToRunExtensions(): Promise<void> {
		// make sure console.log calls make it to the render
		this._instaService.createInstance(ExtHostConsoleForwarder);

		// initialize API and register actors
		const extensionApiFactory = this._instaService.invokeFunction(createApiFactoryAndRegisterActors);

		// Register Download command
		this._instaService.createInstance(ExtHostDownloadService);

		// Register CLI Server for ipc
		if (this._initData.remote.isRemote && this._initData.remote.authority) {
			const cliServer = this._instaService.createInstance(CLIServer);
			process.env['VSCODE_IPC_HOOK_CLI'] = cliServer.ipcHandlePath;
		}

		// Register local file system shortcut
		this._instaService.createInstance(ExtHostDiskFileSystemProvider);

		// Module loading tricks based on `module._load`.
		// `module._load` intercepts `require(...)`.
		// Module loading tricks based on `module.registerHooks`.
		// `module.registerHooks` is a generic interceptor that intercepts `require(...)`, `import ...`, and `import(...)`.
		const requireInterceptor = this._instaService.createInstance(NodeModuleRequireInterceptor, extensionApiFactory, { mine: this._myRegistry, all: this._globalRegistry });
		// Publish app root before install so ESM resolve hooks can gate correctly.
		omnisAppRoot = this._initData.environment.appRoot?.fsPath;
		await this._store.add(requireInterceptor).install();

		// OMNIS CODE write gate — attach after the stock factories so `fs` requires
		// from third-party extensions consult omnis-key (fail closed). No receipt
		// logic lives here; see omnisWriteGate.ts.
		requireInterceptor.register(new OmnisFsModuleFactory());
		requireInterceptor.register(new OmnisFsPromisesModuleFactory());

		performance.mark('code/extHost/didInitAPI');

		// Do this when extension service exists, but extensions are not being activated yet.
		const configProvider = await this._extHostConfiguration.getConfigProvider();
		await connectProxyResolver(this._extHostWorkspace, configProvider, this, this._logService, this._mainThreadTelemetryProxy, this._initData, this._store);
		performance.mark('code/extHost/didInitProxyResolver');
	}

	protected _getEntryPoint(extensionDescription: IExtensionDescription): string | undefined {
		return extensionDescription.main;
	}

	private async _doLoadModule<T>(extension: IExtensionDescription | null, module: URI, activationTimesBuilder: ExtensionActivationTimesBuilder, mode: 'esm' | 'cjs'): Promise<T> {
		if (module.scheme !== Schemas.file) {
			throw new Error(`Cannot load URI: '${module}', must be of file-scheme`);
		}
		let r: T | null = null;
		activationTimesBuilder.codeLoadingStart();
		this._logService.trace(`ExtensionService#loadModule [${mode}] -> ${module.toString(true)}`);
		this._logService.flush();
		const extensionId = extension?.identifier.value;
		if (extension) {
			await this._extHostLocalizationService.initializeLocalizedMessages(extension);
		}
		try {
			if (extensionId) {
				performance.mark(`code/extHost/willLoadExtensionCode/${extensionId}`);
			}
			if (mode === 'esm') {
				r = <T>await import(module.toString(true));
			} else {
				r = <T>require(module.fsPath);
			}
		} finally {
			if (extensionId) {
				performance.mark(`code/extHost/didLoadExtensionCode/${extensionId}`);
			}
			activationTimesBuilder.codeLoadingStop();
		}
		return r;
	}

	protected async _loadCommonJSModule<T>(extension: IExtensionDescription | null, module: URI, activationTimesBuilder: ExtensionActivationTimesBuilder): Promise<T> {
		return this._doLoadModule<T>(extension, module, activationTimesBuilder, 'cjs');
	}

	protected async _loadESMModule<T>(extension: IExtensionDescription | null, module: URI, activationTimesBuilder: ExtensionActivationTimesBuilder): Promise<T> {
		return this._doLoadModule<T>(extension, module, activationTimesBuilder, 'esm');
	}

	public async $setRemoteEnvironment(env: { [key: string]: string | null }): Promise<void> {
		if (!this._initData.remote.isRemote) {
			return;
		}

		for (const key in env) {
			const value = env[key];
			if (value === null) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	}
}
