// Words for the moments that don't need an AI call (and for offline mode).
// Jamaican members get warm Jamaican English with a light touch of Patois.
import type { Member } from '../../shared/types.js';

const jm = (m: Member) => m.language === 'jm';

export const say = {
  payRequest(
    m: Member,
    o: { week: number; amount: string; date: string; recipientName: string; pot: string; isRecipient: boolean },
  ): string {
    if (o.isRecipient) {
      return jm(m)
        ? `A fi yuh draw week, ${m.callName}! Throw yuh Week ${o.week} hand (${o.amount}) same way, an yuh ${o.pot} draw come ${o.date}.`
        : `It's your draw week, ${m.callName}! Your Week ${o.week} hand is ${o.amount} as usual, and your ${o.pot} draw comes ${o.date}.`;
    }
    return jm(m)
      ? `Morning ${m.callName}! Yuh Week ${o.week} hand (${o.amount}) due by ${o.date}. ${o.recipientName} draw ${o.pot} dat day.`
      : `${m.callName}, your Week ${o.week} hand of ${o.amount} is due by ${o.date}. ${o.recipientName} draws ${o.pot} that day.`;
  },

  reminder(m: Member, o: { week: number; amount: string; date: string; recipientName: string }): string {
    return jm(m)
      ? `Wah gwaan ${m.callName}! Likkle reminder seh yuh Week ${o.week} hand (${o.amount}) still outstanding, an ${o.recipientName} draw ${o.date}. Tap below fi pay inna PayPal. Bless up!`
      : `Hi ${m.callName}, just a gentle nudge: your Week ${o.week} hand of ${o.amount} is still open, and ${o.recipientName}'s draw is ${o.date}. Tap below to pay in PayPal. Thank you!`;
  },

  cashThanks(m: Member, o: { week: number; amount: string }): string {
    return jm(m)
      ? `Mi get yuh ${o.amount} cash hand fi Week ${o.week}, ${m.callName}. It record pon yuh PayPal invoice, so everybody can see it. Tank yuh!`
      : `Got your ${o.amount} cash hand for Week ${o.week}, ${m.callName}. It's recorded on your PayPal invoice, so the whole circle can see it. Thank you!`;
  },

  paidThanks(m: Member, o: { week: number }): string {
    return jm(m)
      ? `Yuh Week ${o.week} hand come through pon PayPal. Tank yuh, ${m.callName}!`
      : `Your Week ${o.week} hand came through on PayPal. Thank you, ${m.callName}!`;
  },

  swapAsk(
    c: Member,
    o: {
      requesterName: string;
      reason: string;
      week: number;
      date: string;
      newWeek: number;
      newDate: string;
      spareDays: number | null;
      needBy: string | null;
    },
  ): string {
    const has = o.needBy && o.spareDays !== null;
    // The app writes this itself, so it must speak every language the banker can.
    if (c.language === 'es') {
      const keep = has ? `Aún tendrías tu dinero ${o.spareDays} días antes del ${o.needBy}.` : '';
      return `${c.callName}, ${o.requesterName} tiene una emergencia familiar y pidió recibir su turno antes. ¿Cambiarías tu turno de la semana ${o.week} (${o.date}) por el de la semana ${o.newWeek} (${o.newDate})? ${keep} Nada cambia a menos que digas que sí.`;
    }
    if (c.language === 'ht') {
      const keep = has ? `Ou t ap toujou gen lajan ou ${o.spareDays} jou anvan ${o.needBy}.` : '';
      return `${c.callName}, ${o.requesterName} gen yon ijans fanmi e li mande pou l resevwa tou pa l pi bonè. Èske ou ta dakò chanje tou pa w semèn ${o.week} (${o.date}) pou semèn ${o.newWeek} (${o.newDate})? ${keep} Anyen pa chanje si ou pa di wi.`;
    }
    const keep = has
      ? jm(c)
        ? `Yuh still get yuh money ${o.spareDays} days before ${o.needBy}.`
        : `You'd still have your money ${o.spareDays} days before your ${o.needBy} date.`
      : '';
    return jm(c)
      ? `${c.callName}, ${o.requesterName} have ${o.reason} an ask fi draw early. Yuh woulda swap yuh Week ${o.week} draw (${o.date}) fi Week ${o.newWeek} (${o.newDate})? ${keep} Nutten change unless yuh seh yes.`
      : `${c.callName}, ${o.requesterName} has ${o.reason} and asked to draw early. Would you swap your Week ${o.week} draw (${o.date}) for Week ${o.newWeek} (${o.newDate})? ${keep} Nothing changes unless you say yes.`;
  },

  swapRequestedAck(r: Member, o: { counterpartyName: string; week: number; date: string }): string {
    return jm(r)
      ? `Mi sorry fi hear dat, ${r.callName}. Mi ask ${o.counterpartyName}, who draw Week ${o.week} (${o.date}), fi swap wid yuh. Dem money still land before dem need it. Soon as dem ansa, mi wi tell yuh.`
      : `I'm so sorry, ${r.callName}. I've asked ${o.counterpartyName}, who draws Week ${o.week} (${o.date}), to swap with you. Their money still lands before they need it. I'll tell you as soon as they answer.`;
  },

  swapAcceptedRequester(
    r: Member,
    o: { counterpartyName: string; week: number; date: string; pot: string; ready: boolean; hostName: string },
  ): string {
    const next = o.ready
      ? jm(r)
        ? `All di hand dem in fi dis week, so mi ask ${o.hostName} fi approve di payout.`
        : `All this week's hands are in, so I've asked ${o.hostName} to approve the payout.`
      : jm(r)
        ? 'Mi wi sen it soon as all di hand dem come in.'
        : "I'll send it as soon as this week's hands are in.";
    return jm(r)
      ? `${o.counterpartyName} seh yes! Yuh draw move to Week ${o.week} (${o.date}): ${o.pot}. ${next}`
      : `${o.counterpartyName} said yes. Your draw is now Week ${o.week} (${o.date}): ${o.pot}. ${next}`;
  },

  swapAcceptedCounterparty(c: Member, o: { week: number; date: string; spareDays: number | null; needBy: string | null }): string {
    const keep = o.needBy && o.spareDays !== null ? `, still ${o.spareDays} days before ${o.needBy}` : '';
    return jm(c)
      ? `Tank yuh, ${c.callName}, dat mean nuff. Yuh draw now Week ${o.week} (${o.date})${keep}.`
      : `Thank you, ${c.callName}. That means a lot. Your draw is now Week ${o.week} (${o.date})${keep}.`;
  },

  swapDeclinedRequester(r: Member, o: { counterpartyName: string; hostName: string }): string {
    return jm(r)
      ? `${o.counterpartyName} cyaan swap dis time, an dat alright. Mi wi look fi anodda way an tell ${o.hostName}.`
      : `${o.counterpartyName} can't swap this time, and that's okay. I'll look for another way and tell ${o.hostName}.`;
  },

  swapDeclinedCounterparty(c: Member, o: { week: number; date: string }): string {
    return jm(c)
      ? `No problem. Yuh Week ${o.week} draw (${o.date}) stay same way.`
      : `No problem at all. Your Week ${o.week} draw (${o.date}) stays as it is.`;
  },

  payoutLanded(m: Member, o: { week: number; pot: string }): string {
    return jm(m)
      ? `Yuh Week ${o.week} draw, ${o.pot}, deh inna yuh PayPal now, ${m.callName}. Tek care a wah matter.`
      : `Your Week ${o.week} draw of ${o.pot} is in your PayPal now, ${m.callName}. Take care of what matters.`;
  },

  myDraw(m: Member, o: { week: number; date: string; pot: string; handLine: string }): string {
    return jm(m)
      ? `Yuh draw a Week ${o.week} (${o.date}): ${o.pot}. ${o.handLine}`
      : `Your draw is Week ${o.week} (${o.date}): ${o.pot}. ${o.handLine}`;
  },

  noSwapPossible(m: Member, o: { hostName: string }): string {
    return jm(m)
      ? `Mi hear yuh, ${m.callName}. Right now nobody can swap widout dem get hurt, so mi tell ${o.hostName} fi help sort it out.`
      : `I hear you, ${m.callName}. Right now nobody can swap without being hurt themselves, so I've asked ${o.hostName} to help.`;
  },

  thanks(m: Member): string {
    return jm(m) ? `Anytime, ${m.callName}. Mi deh yah.` : `Anytime, ${m.callName}. I'm here.`;
  },
};
