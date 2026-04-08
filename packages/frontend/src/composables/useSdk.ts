import { inject, type InjectionKey } from "vue";
import type { CaidoSDK } from "../types";

export const sdkKey: InjectionKey<CaidoSDK> = Symbol("caido-sdk");

export function useSdk(): CaidoSDK {
  const sdk = inject(sdkKey);
  if (!sdk) throw new Error("SDK not provided");
  return sdk;
}
