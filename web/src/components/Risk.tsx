import type { Snapshot } from '../../../shared/types';
import { memberMap, money } from '../util';
import { Avatar } from './PersonaPicker';

export function Risk({ snap }: { snap: Snapshot }) {
  const members = memberMap(snap);
  const { risk } = snap;
  return (
    <div className="risk">
      <div className="risk-head">
        <p className="risk-figure">
          {money(risk.exposure)}
          <small>still owed by members who have already drawn</small>
        </p>
        <p className="panel-lead">{risk.note}</p>
      </div>
      {risk.rows.length > 0 && (
        <table className="risk-table">
          <thead>
            <tr>
              <th scope="col">Member</th>
              <th scope="col">Drew in</th>
              <th scope="col">Hands still to pay</th>
              <th scope="col">Amount</th>
              <th scope="col">Reminders since drawing</th>
            </tr>
          </thead>
          <tbody>
            {risk.rows.map((r) => {
              const m = members.get(r.memberId)!;
              return (
                <tr key={r.memberId}>
                  <th scope="row">
                    <span className="risk-who">
                      <Avatar m={m} size={24} />
                      {m.name}
                    </span>
                  </th>
                  <td>Week {r.drewWeek}</td>
                  <td>{r.handsRemaining}</td>
                  <td>{money(r.amountRemaining)}</td>
                  <td className={r.remindersAfterDraw ? 'warn' : ''}>{r.remindersAfterDraw}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="fineprint">
        New members draw only after paying in for {snap.circle.trustWeeks} weeks, which keeps this number low early in
        the circle.
      </p>
    </div>
  );
}
