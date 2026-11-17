"use client";
// A day as a fixed tile at the start of a row: the date large, the weekday under it. Empty keeps the column when
// several rows share one day.
import "./datetile.css";

export function DateTile({ day, weekday, today, empty }: { day?: number; weekday?: string; today?: boolean; empty?: boolean }) {
  return (
    <span className="sp-ui-datetile" data-today={today || undefined} aria-hidden={empty || undefined}>
      {!empty && <><strong className="ap-num">{day}</strong><span>{weekday}</span></>}
    </span>
  );
}
