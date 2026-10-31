import type { LedgerAccountType } from '@goturtle/shared';

/**
 * Chart of accounts.
 *
 *  Normal balance: ASSET & EXPENSE are debit-normal (balance = debits − credits),
 *  LIABILITY, EQUITY & REVENUE are credit-normal (balance = credits − debits).
 *
 *  Money flow of a COD order (collected 1,000 EGP, fees 57 EGP incl. VAT):
 *    hero delivers ......... Dr 1100 Hero custody 1,000   / Cr 2100 Brand wallet 1,000
 *    fees .................. Dr 2100 Brand wallet    57   / Cr 4000 Shipping revenue, 4010 COD fees, 2300 VAT
 *    hero earning .......... Dr 5000 Hero pay         20  / Cr 2200 Hero payable 20
 *    hero hands cash over .. Dr 1000 Treasury     1,000   / Cr 1100 Hero custody 1,000
 *    brand settlement ...... Dr 2100 Brand wallet   943   / Cr 1010 Bank 943
 *    hero payout ........... Dr 2200 Hero payable    20   / Cr 1010 Bank 20
 */
export const CompanyAccounts = {
  TREASURY: { code: '1000', name: 'Cash treasury (hubs & safe)', type: 'ASSET' },
  BANK: { code: '1010', name: 'Bank & e-wallets', type: 'ASSET' },
  PAYMENT_GATEWAY: { code: '1020', name: 'Payment gateway clearing', type: 'ASSET' },
  DIGITAL_CLEARING: { code: '1030', name: 'Digital collections awaiting confirmation (InstaPay / wallets)', type: 'ASSET' },
  VAT_PAYABLE: { code: '2300', name: 'VAT payable (14%)', type: 'LIABILITY' },
  EQUITY: { code: '3000', name: 'Owner equity', type: 'EQUITY' },
  REVENUE_SHIPPING: { code: '4000', name: 'Shipping revenue', type: 'REVENUE' },
  REVENUE_COD_FEES: { code: '4010', name: 'COD fee revenue', type: 'REVENUE' },
  REVENUE_RETURNS: { code: '4020', name: 'Return fee revenue', type: 'REVENUE' },
  REVENUE_FINANCE: { code: '4030', name: 'Finance fees (early payouts & COD advances)', type: 'REVENUE' },
  REVENUE_OTHER: { code: '4900', name: 'Other income (penalties)', type: 'REVENUE' },
  EXPENSE_COURIER_PAY: { code: '5000', name: 'Hero pay', type: 'EXPENSE' },
  EXPENSE_OPERATIONS: { code: '5100', name: 'Operations expenses', type: 'EXPENSE' },
  EXPENSE_CASH_VARIANCE: { code: '5200', name: 'Cash variance & write-offs', type: 'EXPENSE' },
  EXPENSE_CLAIMS: { code: '5300', name: 'Claims (lost / damaged parcels)', type: 'EXPENSE' },
} as const satisfies Record<string, { code: string; name: string; type: LedgerAccountType }>;

export type CompanyAccountKey = keyof typeof CompanyAccounts;

/** Account reference understood by LedgerService.post(). */
export type AccountRef =
  | { company: CompanyAccountKey }
  | { brandWallet: string }
  | { courierCustody: string }
  | { courierPayable: string }
  /** Money advanced to a brand before settlement (receivable, recovered at settlement). */
  | { brandAdvance: string };

export function describeRef(ref: AccountRef): { code: string; name: string; type: LedgerAccountType; brandId?: string; courierId?: string } {
  if ('company' in ref) return { ...CompanyAccounts[ref.company] };
  if ('brandWallet' in ref) return { code: `2100:BRAND:${ref.brandWallet}`, name: 'Brand wallet (COD payable)', type: 'LIABILITY', brandId: ref.brandWallet };
  if ('courierCustody' in ref) return { code: `1100:HERO:${ref.courierCustody}`, name: 'Hero cash custody', type: 'ASSET', courierId: ref.courierCustody };
  if ('brandAdvance' in ref) return { code: `1300:BRAND:${ref.brandAdvance}`, name: 'Brand advances receivable', type: 'ASSET', brandId: ref.brandAdvance };
  return { code: `2200:HERO:${ref.courierPayable}`, name: 'Hero earnings payable', type: 'LIABILITY', courierId: ref.courierPayable };
}

export const isDebitNormal = (type: LedgerAccountType) => type === 'ASSET' || type === 'EXPENSE';
