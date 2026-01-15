// Consolidated ambient declarations for JS API modules.
// Keeps the JavaScript implementations while giving TypeScript awareness.

declare module './_admin.js' {
  export default function handler(req: any, res: any): Promise<any>;
}

declare module './_caseopening.js' {
  export function handleOpenCases(req: any, res: any): Promise<void>;
  export default function handler(req: any, res: any): Promise<any>;
}

declare module './_chat.js' {
  export default function handler(req: any, res: any): Promise<any>;
}

declare module './_inventory.js' {
  export default function handler(req: any, res: any): Promise<any>;
}

declare module './_profile.js' {
  export default function handler(req: any, res: any): Promise<any>;
}

declare module './_referrals.js' {
  export function applyReferralCommissionForSpend(args: any): Promise<void>;
  export function applyReferralDiamondBonus(args: any): Promise<void>;
  export default function handler(req: any, res: any): Promise<any>;
}

declare module './_shop.js' {
  export const config: any;
  export default function handler(req: any, res: any): Promise<any>;
}

declare module './_support.js' {
  export default function handler(req: any, res: any): Promise<any>;
}

// _utils now has TypeScript version, so types come from there
