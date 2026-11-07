import type {createExperimentalPlateWorkflow} from './experimental-plate.mjs';

export declare const LOCAL_PLATE_BRIDGE_FORMAT:'intuit3d.local-plate-bridge';
export declare const LOCAL_PLATE_BRIDGE_VERSION:1;
/** Authenticated provider-configuration identity, not native execution evidence. */
export declare const LOCAL_PLATE_CAPABILITY_FORMAT:'intuit3d.local-plate-bridge-capability';
export declare const LOCAL_PLATE_CAPABILITY_VERSION:1;

/** Node-only listener, bound to 127.0.0.1, with a per-launch secret. */
export interface LocalPlateBridge {
  readonly url:string;
  readonly token:string;
  close():Promise<void>;
}
export declare function startLocalPlateBridge(
  options:Parameters<typeof createExperimentalPlateWorkflow>[0] & Readonly<{
    /** Allowed local workbench origin, default http://127.0.0.1:5173 */
    origin?:string;
    /** Loopback port; 0 selects an available ephemeral port. */
    port?:number;
    /** Real experimental provider deadline in milliseconds. */
    timeoutMs?:number;
  }>
):Promise<LocalPlateBridge>;

/** Trusted Node-only bridge for pinned OCCT 8.0.1 C++ with mandatory Part21 audit.
 * The existing browser client and live session are unchanged.
 */
export declare function startLocalPinnedOcct8Bridge(
  options:Omit<Parameters<typeof startLocalPlateBridge>[0],
    'runExperimentalPlate'|'providerKind'> & Readonly<{
      workerExecutable:string;
      runPinnedOcct8Plate:typeof import('@intuit3d/kernel-contract/local-occt8-provider').runPinnedOcct8Plate;
      pythonExecutable?:string;
      crossVersionStepAudit?:boolean;
    }>
):Promise<LocalPlateBridge>;
