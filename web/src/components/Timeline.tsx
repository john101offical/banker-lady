import { Scheduler, StringHelper } from '@bryntum/scheduler';
import '@bryntum/scheduler/fontawesome/css/fontawesome.css';
import '@bryntum/scheduler/fontawesome/css/solid.css';
import '@bryntum/scheduler/scheduler.css';
import '@bryntum/scheduler/svalbard-light.css';
import { useEffect, useMemo, useRef } from 'react';
import type { Snapshot } from '../../../shared/types';
import { addDays, localDate, memberMap, money, shortDay, weekDate } from '../util';

/** Each member's row: a green band up to the date they need the money, and their draw on top. */
function buildData(snap: Snapshot) {
  const { circle, members, draws } = snap;
  const resources = circle.memberIds.map((id) => {
    const m = members.find((x) => x.id === id)!;
    return { id: m.id, name: m.callName };
  });
  const events = draws.map((d) => {
    const m = members.find((x) => x.id === d.memberId)!;
    const color = d.status === 'paid' ? 'gray' : d.status === 'processing' ? 'indigo' : 'violet';
    return {
      id: `draw-${d.memberId}`,
      resourceId: d.memberId,
      startDate: localDate(weekDate(circle, d.week)),
      endDate: localDate(addDays(weekDate(circle, d.week), 6)),
      name: money(d.amount),
      verb: d.status === 'paid' ? 'Drew' : d.status === 'processing' ? 'Sending' : 'Draws',
      eventColor: color,
      week: d.week,
      member: m.callName,
      status: d.status,
    };
  });
  const ranges = members
    .filter((m) => m.goal.needBy)
    .map((m) => ({
      id: `need-${m.id}`,
      resourceId: m.id,
      startDate: localDate(addDays(circle.startDate, -7)),
      endDate: localDate(m.goal.needBy!),
      name: `Needs it by ${shortDay(m.goal.needBy!)}`,
      timeRangeColor: 'green',
    }));
  const now = weekDate(circle, circle.currentWeek);
  const timeRanges = [{ id: 'this-week', name: 'This week', startDate: localDate(now) }];
  const lastNeed = members.map((m) => m.goal.needBy ?? circle.startDate).sort().at(-1)!;
  const lastDraw = weekDate(circle, circle.memberIds.length);
  const end = [addDays(lastNeed, 10), addDays(lastDraw, 14)].sort().at(-1)!;
  return {
    resources,
    events,
    ranges,
    timeRanges,
    start: localDate(addDays(circle.startDate, -7)),
    end: localDate(end),
  };
}

export function Timeline({ snap }: { snap: Snapshot }) {
  const host = useRef<HTMLDivElement>(null);
  const scheduler = useRef<Scheduler | null>(null);
  const data = useMemo(() => buildData(snap), [snap]);

  useEffect(() => {
    if (!host.current) return;
    const d = buildData(snap);
    scheduler.current = new Scheduler({
      appendTo: host.current,
      startDate: d.start,
      endDate: d.end,
      viewPreset: 'weekAndMonth',
      readOnly: true,
      rowHeight: 50,
      barMargin: 12,
      enableEventAnimations: true,
      columns: [{ text: 'Member', field: 'name', width: 130 }],
      resources: d.resources,
      events: d.events,
      resourceTimeRanges: d.ranges,
      timeRanges: d.timeRanges,
      features: {
        resourceTimeRanges: true,
        timeRanges: { showCurrentTimeLine: false },
        eventTooltip: {
          template: ({ eventRecord }: { eventRecord: any }) =>
            `<b>${StringHelper.encodeHtml(eventRecord.member)}</b> ${StringHelper.encodeHtml(String(eventRecord.verb).toLowerCase())} ${StringHelper.encodeHtml(eventRecord.name)} in Week ${eventRecord.week}`,
        },
        cellMenu: false,
        eventMenu: false,
        scheduleMenu: false,
        timeAxisHeaderMenu: false,
        headerMenu: false,
        eventDrag: false,
        eventResize: false,
        eventDragCreate: false,
      },
      eventRenderer: ({ eventRecord }: { eventRecord: any }) => StringHelper.encodeHtml(eventRecord.name),
    } as any);
    return () => {
      scheduler.current?.destroy();
      scheduler.current = null;
    };
    // The scheduler is created once; later changes are applied to its stores below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const s = scheduler.current as any;
    if (!s) return;
    for (const e of data.events) {
      const rec = s.eventStore.getById(e.id);
      if (rec) rec.set(e);
      else s.eventStore.add(e);
    }
    s.resourceTimeRangeStore.data = data.ranges;
    s.timeRangeStore.data = data.timeRanges;
  }, [data]);

  const members = memberMap(snap);
  return (
    <div className="timeline">
      <p className="panel-lead">
        Green shows when each member needs their money. A draw inside the green arrives on time.
      </p>
      <div ref={host} className="bryntum-host" />
      <h3 className="why-title">Why the draws fall where they do</h3>
      <ol className="why">
        {snap.plan.map((p) => {
          const m = members.get(p.memberId)!;
          return (
            <li key={p.week} className={p.onTime ? '' : 'late'}>
              <span className="why-week">
                Week {p.week}
                <small>{shortDay(p.date)}</small>
              </span>
              <span className="why-who" style={{ color: m.color }}>
                {m.callName}
              </span>
              <span className="why-text">{p.reason}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
