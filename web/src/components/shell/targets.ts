/**
 * Panels the layout can target.
 *
 * The exported file's panel is not one of these - it comes from Target.dat
 * inside the extracted skeleton, which the app cannot change. Choosing one here
 * sets what the layout is designed for; the top bar asks the server what the
 * file will actually say and flags a disagreement rather than showing a label
 * the .eote contradicts.
 *
 * Lifted out of TopBar because the command palette offers the same list, and
 * two copies would be two things to keep in step.
 */

export interface TargetOption {
  value: string;
  label: string;
}

export const TARGETS: TargetOption[] = [
  { value: "HMIGTO6310|1024|768", label: "HMIGTO6310 · 1024 × 768" },
  { value: "HMIGTO5310|800|480", label: "HMIGTO5310 · 800 × 480" },
  { value: "HMIGTO4310|640|480", label: "HMIGTO4310 · 640 × 480" },
  { value: "HMISTU855|320|240", label: "HMISTU855 · 320 × 240" },
];
