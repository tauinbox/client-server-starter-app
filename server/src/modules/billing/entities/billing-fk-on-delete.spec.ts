import { getMetadataArgsStorage } from 'typeorm';
import { Invoice } from './invoice.entity';
import { CreditLedger } from './credit-ledger.entity';

function fkOnDelete(target: new () => object, propertyName: string): string {
  const fk = getMetadataArgsStorage().foreignKeys.find(
    (args) => args.target === target && args.propertyName === propertyName
  );
  if (!fk?.onDelete) {
    throw new Error(
      `No onDelete registered for ${target.name}.${propertyName}`
    );
  }
  return fk.onDelete;
}

describe('billing financial FK onDelete behavior', () => {
  it('invoices must not cascade on customer deletion (financial records)', () => {
    expect(fkOnDelete(Invoice, 'customerId')).toBe('RESTRICT');
  });

  it('credit ledger must not cascade on customer deletion (audit journal)', () => {
    expect(fkOnDelete(CreditLedger, 'customerId')).toBe('RESTRICT');
  });
});
