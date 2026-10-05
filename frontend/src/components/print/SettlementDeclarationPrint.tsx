import type { CSSProperties, ReactNode } from 'react';
import { A4_PRINT_WIDTH_PX } from '../../lib/printPage';
import type { Declarations } from '../../lib/settlementDeclarations';

/**
 * The early termination declaration and the balloon payout declaration, set
 * out as the desk's own Word template: plain Calibri, a bold underlined title,
 * the deal's details, the italic undertakings (with the same phrases
 * underlined) and the sign-off with its yellow sign-here marks. The wording is
 * the template's, word for word — only the deal's details are filled in.
 * Signature and date are left empty for the client.
 *
 * Inline styles only — html2canvas can't read Tailwind's modern colours.
 */

export type DeclarationKind = 'early_termination' | 'balloon_payout';

const FONT = "Calibri, Carlito, 'Segoe UI', Helvetica, Arial, sans-serif";
// Word's 1 inch page margin and 11pt body, at 96dpi.
const SIDE = 96;
const para: CSSProperties = { margin: '0 0 11px' };
const italic: CSSProperties = { fontStyle: 'italic' };

const U = ({ children }: { children: ReactNode }) => <span style={{ textDecoration: 'underline' }}>{children}</span>;
const Mark = ({ children }: { children: ReactNode }) => <span style={{ background: '#ffff00' }}>{children}</span>;

/** One list item. A block wrapper carries the page-break class — it is ignored
 *  on the flex row itself. */
function Item({ marker, indent = 24, gapAfter = 0, children }: { marker: string; indent?: number; gapAfter?: number; children: ReactNode }) {
  return (
    <div className="break-inside-avoid" style={{ marginBottom: gapAfter }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', paddingLeft: indent, ...italic }}>
        <span style={{ flex: 'none', width: 24, fontStyle: 'normal' }}>{marker}</span>
        <span style={{ flex: 1 }}>{children}</span>
      </div>
    </div>
  );
}

const DOT = '•';
const ARROW = '➢';

function Details({ d, strategyLabel }: { d: Declarations; strategyLabel: string }) {
  return (
    <>
      <p style={para}>Application Name – {d.applicationName}</p>
      <p style={para}>Application Number - {d.applicationNumber}</p>
      <p style={para}>Loan term – {d.term}</p>
      <p style={para}>Balloon – {d.balloonLine}</p>
      <p style={para}>{strategyLabel} – {d.payoffStrategy}</p>
    </>
  );
}

function EarlyTermination({ d }: { d: Declarations }) {
  return (
    <>
      <Details d={d} strategyLabel="Balloon payoff strategy" />
      <Item marker={DOT}>
        The loan term as selected by me/us, is <U>{d.term}</U> and <U>{d.balloonPhrase}</U> balloon. The term as selected, is based on my/our plan to use the asset for commercial purposes for the full term of the loan as stipulated on the loan contract.
      </Item>
      <Item marker={DOT}>
        I understand that in a commercial loan contract, starting balance of the loan comprises of full interest costs along with the full principal amount including any fees and charges as stipulated on the contract. This amount is referred to as the’ starting balance/contract amount etc.’ of the loan which is always more than the purchase price of the asset.
      </Item>
      <Item marker={DOT}>
        I understand that the lender<U> may or may not provide us </U>with a preferential/ discounted payout figure in case the contract is finished prior to the completion date (in the event of the asset being sold or written off in an accident or paid off in full). In such an instance, the remaining liability of the contract must be paid in full which will be a sum of the total principal and interest component outstanding on the day of the termination of the contractual agreement. This will be stated on the payout letter from the lender. Depending on the term of the contract served, the payout figure may or may not be more than the purchase price of the asset.
      </Item>
      <Item marker={DOT}>
        I understand that neither the lender nor my broker is liable to provide me with a discounted payout figure under any circumstances.
      </Item>
      <Item marker={DOT} gapAfter={32}>
        For an early termination of the contract: I understand that any time during the term of the loan; I will be liable for covering the shortfall or gap on the loan contract; should the proceeds from the trade-in/private sale of the asset/ insurance payments, are not sufficient to cover the payout figure as provided by the lender.
      </Item>
      <Item marker={ARROW} gapAfter={20}>
        All the details as listed above have been discussed with my broker in detail over the phone and <U>I have read the details/ terms and conditions in full.</U>
      </Item>
      <Item marker={ARROW} gapAfter={22}>
        My broker is not liable for any dispute arising out of the clause of early termination charges.
      </Item>
      {d.signatories.map((name, i) => (
        <div key={i} className="break-inside-avoid">
          <p style={para}>Name: {name}</p>
          <p style={{ ...para, marginBottom: 26 }}><Mark>Signature :</Mark> </p>
          <p style={{ ...para, marginBottom: 20 }}><Mark>Date </Mark>– </p>
        </div>
      ))}
    </>
  );
}

/** The balloon declaration's sign-off: the signers side by side, two to a row. */
function SignOff({ names }: { names: string[] }) {
  const rows: string[][] = [];
  for (let i = 0; i < names.length; i += 2) rows.push(names.slice(i, i + 2));
  return (
    <>
      {rows.map((row, i) => (
        <div key={i} className="break-inside-avoid" style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex' }}>
            {row.map((name, j) => (
              <div key={j} style={{ flex: '0 0 50%', boxSizing: 'border-box', paddingRight: 16 }}>
                <p style={para}>NAME: {name}</p>
                <p style={{ ...para, marginBottom: 26 }}><Mark>SIGNATURE</Mark>:</p>
                <p style={para}><Mark>DATE</Mark>:</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function BalloonPayout({ d }: { d: Declarations }) {
  // "my broker, Sidd Bahree, …" — the broker is named where the template names
  // them, and the sentence still reads when there is no name to print.
  const myBroker = d.brokerName ? `my broker, ${d.brokerName},` : 'my broker';
  return (
    <>
      <Details d={d} strategyLabel="Balloon payoff Strategy" />
      <div style={{ height: 14 }} />
      <Item marker={DOT}>
        I understands that I have 3 available options at the end of the term of the loan to finish the residual/ balloon amount:
      </Item>
      <Item marker="1)" indent={48}>
        Refinance the loan contract (subject to the lender’s criteria at the time of the loan term expiry)
      </Item>
      <Item marker="2)" indent={48}>
        Pay lumpsum amount and finish the contractual liability of residual/balloon amount.
      </Item>
      <Item marker="3)" indent={48}>
        Trade in the vehicle and pay the residual/balloon amount.
      </Item>
      <Item marker="o" indent={120} gapAfter={20}>
        My preference is to settle the residual/balloon figure by paying the lumpsum in cash. However, In such an event of either trading or selling my vehicle/asset privately, I understand that:
      </Item>
      <Item marker={DOT}>
        I will be liable for covering the shortfall amount in case the proceeds from the trade in/private sale of the asset/ insurance payments, are not sufficient to cover the payout figure as provided by the lender (including the residual/balloon amount).
      </Item>
      <Item marker={DOT}>
        I have been explained by {myBroker} all the pertinent consequences of the residual/balloon amount and the liabilities associated with it at the end of the term of the contract. This may impact my credit rating with the lender/s and also with the external reporting agencies.
      </Item>
      <Item marker={DOT}>
        {d.brokerName ? `My broker, ${d.brokerName}` : 'My broker'} has provided me with 2 finance options: Monthly repayments with the balloon amount and monthly repayments without the balloon amount. In this instance, I have <U>voluntarily chosen</U> the repayment option with a balloon amount at the end to keep my monthly repayments low. By signing the loan agreement, I take full responsibility of meeting my obligations for the monthly repayments and covering the balloon liability payment at the end of the term, with one of the 3 options as stated above.
      </Item>
      <Item marker={DOT} gapAfter={48}>
        I understand that the interest is applicable on the full amount to be financed at the start of the contract. Balloon is just the lumpsum amount taken out of the principal &amp; interest costs combined, and payable at the end of the term of the loan contract. <U>RESIDUAL/BALLOON IS NOT EXEMPT FROM THE INTEREST CHARGED ON THE LOAN CONTRACT.</U>
      </Item>
      <SignOff names={d.signatories} />
      <div style={{ height: 30 }} />
      <Item marker={DOT} gapAfter={20}>
        -I understand that by keeping the balloon amount, I will be paying more in interest costs compared to a finance contract without the balloon. This cost has been explained to me over the phone.
      </Item>
      <Item marker={DOT} gapAfter={20}>
        -I understand the risks involved in keeping a balloon/ residual amount at the end; and, I am willing to accept the associated risks on the loan contract.
      </Item>
      <Item marker={ARROW} gapAfter={20}>
        All the details as listed above have been discussed with {myBroker} in detail over the phone.
      </Item>
      <Item marker={ARROW} gapAfter={32}>
        {d.brokerName || 'My broker'} is not liable for any dispute arising out of the clause of the balloon/ residual amount to be paid at the end of the loan.
      </Item>
      <SignOff names={d.signatories} />
    </>
  );
}

export default function SettlementDeclarationPrint({
  kind,
  declarations,
  paddingY = 0,
}: {
  kind: DeclarationKind;
  declarations: Declarations;
  /** Top and bottom inset. The PDF leaves it at 0 and uses page margins
   *  instead, so every page of a long declaration gets them. */
  paddingY?: number;
}) {
  return (
    <div
      style={{
        width: A4_PRINT_WIDTH_PX.portrait,
        background: '#fff',
        color: '#000',
        padding: `${paddingY}px ${SIDE}px`,
        boxSizing: 'border-box',
        fontFamily: FONT,
        fontSize: 14.67,
        lineHeight: 1.3,
      }}
    >
      <p style={{ ...para, textAlign: 'center', fontWeight: 700, textDecoration: 'underline' }}>
        {kind === 'early_termination' ? 'Early termination declaration' : 'Balloon Payout Declaration'}
      </p>
      {kind === 'early_termination' ? <EarlyTermination d={declarations} /> : <BalloonPayout d={declarations} />}
    </div>
  );
}
