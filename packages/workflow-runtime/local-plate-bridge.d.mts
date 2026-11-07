import type {createExperimentalPlateWorkflow} from './experimental-plate.mjs';

export declare const LOCAL_PLATE_BRIDGE_FORMAT:'intuit3d.local-plate-bridge';
export declare const LOCAL_PLATE_BRIDGE_VERSION:1;

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
