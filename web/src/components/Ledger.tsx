import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { useMemo, useState } from 'react';
import type { Snapshot } from '../../../shared/types';
import { memberMap, money, shortDay, weekDate } from '../util';

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
  fontFamily: '"Atkinson Hyperlegible Next", system-ui, sans-serif',
  fontSize: 14,
  accentColor: '#1F2F86',
  backgroundColor: '#FFFFFF',
  foregroundColor: '#272B38',
  headerBackgroundColor: '#F2F5FB',
  headerFontWeight: 600,
  borderColor: '#D7E2F3',
  rowBorder: { color: '#E8EEF8' },
  oddRowBackgroundColor: '#FBFCFE',
  browserColorScheme: 'light',
  wrapperBorderRadius: 10,
});

interface Row {
  week: number;
  date: string;
  member: string;
  kind: 'Hand' | 'Draw';
  amount: number;
  status: string;
  method: string;
  reference: string;
}

const STATUS_CLASS: Record<string, string> = {
  Paid: 'ok',
  Received: 'ok',
  Due: 'warn',
  Reminded: 'warn',
  Sending: 'busy',
  'Awaiting approval': 'busy',
  Ready: 'busy',
  Failed: 'bad',
};

export function Ledger({ snap }: { snap: Snapshot }) {
  const [q, setQ] = useState('');
  const members = memberMap(snap);
  const rows = useMemo<Row[]>(() => {
    const { circle } = snap;
    const out: Row[] = [];
    for (const h of snap.hands) {
      if (h.status === 'upcoming') continue;
      const m = members.get(h.memberId)!;
      out.push({
        week: h.week,
        date: (h.paidAt ?? weekDate(circle, h.week)).slice(0, 10),
        member: m.name,
        kind: 'Hand',
        amount: h.amount,
        status: h.status === 'paid' ? 'Paid' : h.remindersSent ? 'Reminded' : 'Due',
        method:
          h.status !== 'paid'
            ? 'PayPal invoice sent'
            : h.method === 'cash'
              ? h.invoiceNumber
                ? 'Cash, recorded on invoice'
                : 'Cash'
              : h.method === 'book'
                ? 'Partner book'
                : 'PayPal',
        reference: h.invoiceNumber ?? (h.method === 'book' || h.method === 'cash' ? 'Paper book' : ''),
      });
    }
    for (const d of snap.draws) {
      if (d.status === 'upcoming' || d.status === 'collecting') continue;
      const m = members.get(d.memberId)!;
      const status =
        d.status === 'paid'
          ? 'Received'
          : d.status === 'processing'
            ? 'Sending'
            : d.status === 'awaiting_approval'
              ? 'Awaiting approval'
              : d.status === 'ready'
                ? 'Ready'
                : 'Failed';
      out.push({
        week: d.week,
        date: (d.paidAt ?? weekDate(circle, d.week)).slice(0, 10),
        member: m.name,
        kind: 'Draw',
        amount: d.amount,
        status,
        method: d.method === 'book' ? 'Partner book' : 'PayPal Payout',
        reference: d.transactionId ?? d.payoutBatchId ?? (d.method === 'book' ? 'Paper book' : ''),
      });
    }
    return out.sort((a, b) => b.week - a.week || (a.kind === b.kind ? a.member.localeCompare(b.member) : a.kind === 'Draw' ? -1 : 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.hands, snap.draws]);

  const columns = useMemo<ColDef<Row>[]>(
    () => [
      { field: 'week', headerName: 'Week', width: 86, filter: 'agNumberColumnFilter' },
      { field: 'member', headerName: 'Member', flex: 1.3, minWidth: 140, filter: true },
      { field: 'kind', headerName: 'Type', width: 96, filter: true },
      {
        field: 'amount',
        headerName: 'Amount',
        width: 104,
        type: 'rightAligned',
        valueFormatter: (p) => money(p.value ?? 0),
        filter: 'agNumberColumnFilter',
      },
      {
        field: 'status',
        headerName: 'Status',
        width: 150,
        filter: true,
        cellRenderer: (p: { value: string }) => <span className={`pill ${STATUS_CLASS[p.value] ?? ''}`}>{p.value}</span>,
      },
      { field: 'method', headerName: 'Paid through', flex: 1.4, minWidth: 170, filter: true },
      { field: 'reference', headerName: 'PayPal reference', flex: 1.5, minWidth: 190, filter: true },
      { field: 'date', headerName: 'Date', width: 100, valueFormatter: (p) => (p.value ? shortDay(p.value) : '') },
    ],
    [],
  );

  return (
    <div className="ledger">
      <div className="ledger-bar">
        <p className="panel-lead">
          Every hand is a PayPal invoice and every draw a PayPal Payout. Cash is recorded on the same invoice.
        </p>
        <label className="search">
          <span className="sr-only">Search the ledger</span>
          <input
            type="search"
            placeholder="Search, e.g. cash or Devon"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </div>
      <div className="grid-box">
        <AgGridReact<Row>
          theme={theme}
          rowData={rows}
          columnDefs={columns}
          quickFilterText={q}
          getRowId={(p) => `${p.data.kind}-${p.data.week}-${p.data.member}`}
          animateRows
          suppressCellFocus
        />
      </div>
    </div>
  );
}
