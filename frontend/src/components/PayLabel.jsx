import React from 'react';

const money = (n) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);

/** "$30/hr", "$30–$35/hr", or null when pay is hidden. */
export function payText(rate, rateMax) {
  if (rate === null || rate === undefined || rate === '') return null;
  const lo = Number(rate);
  if (Number.isNaN(lo)) return null;
  const hi = rateMax === null || rateMax === undefined || rateMax === '' ? null : Number(rateMax);
  return hi && hi > lo ? `${money(lo)}–${money(hi)}/hr` : `${money(lo)}/hr`;
}

export default function PayLabel({ rate, rateMax, className = '', hiddenText = 'Pay not listed' }) {
  const text = payText(rate, rateMax);
  return <span className={text ? className : 'text-slate-400 italic text-xs'}>{text || hiddenText}</span>;
}
