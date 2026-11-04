/*
 * Why a video or AI clip didn't finish, in words an agent understands. Messages the app writes for people
 * are shown as they are; technical ones (FFmpeg, Chrome, network errors) become a plain explanation —
 * the technical text stays in the job record and the System health page for administrators.
 */
const FOR_PEOPLE = /^(A photo|A file|This photo|This video|The source photo|This AI provider|AI clips|Unknown video shape|The AI clip|The AI provider|Your |The company)/;

export function jobErrorForPeople(message: string | null | undefined): string {
  const m = (message ?? "").trim();
  if (m && FOR_PEOPLE.test(m) && m.length <= 240) return m;
  if (/stopped responding|timed? ?out|timeout/i.test(m)) return "It took too long and was stopped. Press the button to try again.";
  if (/spending limit/i.test(m)) return "The company's AI spending limit was reached. Ask your Super Admin.";
  if (/\(4(01|03)\)|unauthori[sz]ed|invalid api key/i.test(m)) return "The AI service refused the request (its key may have expired). Tell your administrator.";
  if (/\(429\)|rate limit|credit/i.test(m)) return "The AI service is busy or out of credit. Try again later, or tell your administrator.";
  return "Something went wrong while making it. Try again — if it keeps happening, tell your administrator.";
}
