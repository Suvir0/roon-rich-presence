import type { RrpApi } from '../shared/contracts';

export {};

declare global {
  interface Window {
    rrp?: RrpApi;
  }
}
