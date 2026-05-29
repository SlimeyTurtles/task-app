/** Shared mapping between the UI "repeat" choices and the RRULE subset we store. */

export type Repeat = "none" | "daily" | "weekdays" | "weekly";

export const REPEAT_OPTIONS: { value: Repeat; label: string }[] = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Weekdays (Mon–Fri)" },
  { value: "weekly", label: "Weekly" },
];

export function repeatToRrule(repeat: Repeat): string | null {
  switch (repeat) {
    case "daily": return "FREQ=DAILY";
    case "weekdays": return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
    case "weekly": return "FREQ=WEEKLY";
    case "none": return null;
  }
}

export function rruleToRepeat(rrule: string | null | undefined): Repeat {
  if (!rrule) return "none";
  const up = rrule.toUpperCase();
  if (up.includes("FREQ=DAILY")) return "daily";
  if (up.includes("FREQ=WEEKLY") && up.includes("BYDAY=MO,TU,WE,TH,FR")) return "weekdays";
  if (up.includes("FREQ=WEEKLY")) return "weekly";
  return "none";
}

export function repeatLabel(rrule: string | null | undefined): string {
  switch (rruleToRepeat(rrule)) {
    case "daily": return "Daily";
    case "weekdays": return "Weekdays";
    case "weekly": return "Weekly";
    case "none": return "Once";
  }
}
