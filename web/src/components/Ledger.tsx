import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { useMemo, useRef, useState } from 'react';
import { ledgerRows, type LedgerAnswer, type LedgerRow } from '../../../shared/ledger';
import type { Snapshot } from '../../../shared/types';
import { post } from '../api';
import { money, shortDay } from '../util';

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

type Row = LedgerRow;

// Asking the ledger can put several conditions on one column, such as Due or Reminded,
// and "weeks 1 to 2" means both of those weeks, which AG Grid's ranges leave out by default.
const MANY = { maxNumConditions: 4, inRangeInclusive: true };
const EXAMPLES = ['Who paid cash?', 'Who still owes this week?', 'Show me the draws', 'Anything over $100?'];

function shownLine({ rows, people }: { rows: number; people: string[] }): string {
  if (rows === 0) return 'Nothing in the ledger matches.';
  const count = `${rows} ${rows === 1 ? 'row' : 'rows'}`;
  if (people.length === 1) return `${count}, all ${people[0]}.`;
  return people.length <= 3 ? `${count}: ${people.join(', ')}.` : `${count} across ${people.length} people.`;
}

/** The grid hands the date filter a local midnight; rows hold plain YYYY-MM-DD. */
function compareDay(filterDay: Date, cell: string): number {
  const [y, m, d] = String(cell).split('-').map(Number);
  const day = new Date(y, m - 1, d).getTime();
  return day < filterDay.getTime() ? -1 : day > filterDay.getTime() ? 1 : 0;
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
  const grid = useRef<AgGridReact<Row>>(null);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [reply, setReply] = useState<LedgerAnswer | null>(null);
  const [shown, setShown] = useState<{ rows: number; people: string[] } | null>(null);
  const rows = useMemo(() => ledgerRows(snap), [snap.hands, snap.draws, snap.members, snap.circle]);

  const countShown = () => {
    const api = grid.current?.api;
    if (!api) return;
    const people = new Set<string>();
    api.forEachNodeAfterFilter((n) => {
      if (n.data) people.add(n.data.member);
    });
    setShown({ rows: api.getDisplayedRowCount(), people: [...people] });
  };

  const ask = async (text: string) => {
    const clean = text.trim();
    const api = grid.current?.api;
    if (!clean || !api) return;
    setQuestion(clean);
    setAsking(true);
    const res = await post<LedgerAnswer>('/api/ledger/ask', { question: clean });
    setAsking(false);
    if (!res) return;
    setReply(res);
    if (!res.understood) return;
    api.setFilterModel(Object.keys(res.filterModel).length ? res.filterModel : null);
    api.applyColumnState({
      state: res.sort ? [{ colId: res.sort.column, sort: res.sort.direction }] : [],
      defaultState: { sort: null },
    });
    countShown();
  };

  const clear = () => {
    const api = grid.current?.api;
    api?.setFilterModel(null);
    api?.applyColumnState({ defaultState: { sort: null } });
    setReply(null);
    setQuestion('');
  };

  const columns = useMemo<ColDef<Row>[]>(
    () => [
      { field: 'week', headerName: 'Week', width: 86, filter: 'agNumberColumnFilter', filterParams: MANY },
      { field: 'member', headerName: 'Member', flex: 1.3, minWidth: 140, filter: 'agTextColumnFilter', filterParams: MANY },
      { field: 'kind', headerName: 'Type', width: 96, filter: 'agTextColumnFilter', filterParams: MANY },
      {
        field: 'amount',
        headerName: 'Amount',
        width: 104,
        type: 'rightAligned',
        valueFormatter: (p) => money(p.value ?? 0),
        filter: 'agNumberColumnFilter',
        filterParams: MANY,
      },
      {
        field: 'status',
        headerName: 'Status',
        width: 150,
        filter: 'agTextColumnFilter',
        filterParams: MANY,
        cellRenderer: (p: { value: string }) => <span className={`pill ${STATUS_CLASS[p.value] ?? ''}`}>{p.value}</span>,
      },
      { field: 'method', headerName: 'Paid through', flex: 1.4, minWidth: 170, filter: 'agTextColumnFilter', filterParams: MANY },
      { field: 'reference', headerName: 'PayPal reference', flex: 1.5, minWidth: 190, filter: 'agTextColumnFilter', filterParams: MANY },
      {
        field: 'date',
        headerName: 'Date',
        width: 100,
        cellDataType: false,
        valueFormatter: (p) => (p.value ? shortDay(p.value) : ''),
        filter: 'agDateColumnFilter',
        filterParams: { ...MANY, comparator: compareDay },
      },
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
      <form
        className="ask-ledger"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <label htmlFor="ask-ledger-input">Ask the ledger</label>
        <div className="ask-row">
          <input
            id="ask-ledger-input"
            value={question}
            maxLength={300}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Who paid cash?"
          />
          <button type="submit" className="primary" disabled={asking || !question.trim()}>
            {asking ? 'Reading…' : 'Ask'}
          </button>
        </div>
        <div className="ask-examples" aria-label="Example questions">
          {EXAMPLES.map((text) => (
            <button key={text} type="button" disabled={asking} onClick={() => void ask(text)}>
              {text}
            </button>
          ))}
        </div>
        {reply && (
          <p className={`ask-reply ${reply.understood ? '' : 'unsure'}`} role="status">
            {reply.answer}
            {reply.understood && shown && ` ${shownLine(shown)}`}{' '}
            <button type="button" className="link" onClick={clear}>
              {reply.understood ? 'Clear' : 'Dismiss'}
            </button>
          </p>
        )}
      </form>
      <div className="grid-box">
        <AgGridReact<Row>
          ref={grid}
          theme={theme}
          rowData={rows}
          onFilterChanged={countShown}
          onRowDataUpdated={countShown}
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
