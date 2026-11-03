import { describe, expect, it } from "vitest";
import { alignWords, buildCues, houseNumber, numberToWords, sentences, speakable, synthesize, transcribe, unknownWords, voiceModelsAvailable } from "./index.ts";

describe("speakable text", () => {
  it("numbers, prices, house numbers, states and abbreviations", () => {
    expect(numberToWords(525000)).toBe("five hundred twenty-five thousand");
    expect(numberToWords(2150)).toBe("two thousand one hundred fifty");
    expect(houseNumber(742)).toBe("seven forty-two");
    expect(houseNumber(1600)).toBe("sixteen hundred");
    expect(houseNumber(305)).toBe("three oh five");
    const s = speakable("Welcome to 742 Evergreen Terrace, Springfield, OR. Offered at $525,000 with 2.5 baths and 2,150 sq ft.").spoken;
    expect(s).toBe("welcome to seven forty two evergreen terrace, springfield, oregon. offered at five hundred twenty five thousand dollars with two and a half baths and two thousand one hundred fifty square feet.");
    expect(speakable("$1.2M").spoken).toBe("one point two million dollars");
    expect(speakable("the 2nd floor").spoken).toBe("the second floor");
  });
  it("splits sentences", () => {
    expect(sentences("One home. Two baths! $5 more? Yes.")).toEqual(["One home.", "Two baths!", "$5 more?", "Yes."]);
  });
});

describe("captions", () => {
  it("aligns the written script to heard words, including expanded numbers and mistakes", () => {
    const heard = [
      ["offered", 0.1, 0.5], ["at", 0.5, 0.6], ["five", 0.6, 0.8], ["hundred", 0.8, 1.0], ["twenty", 1.0, 1.2], ["five", 1.2, 1.3], ["thousand", 1.3, 1.6], ["dollers", 1.6, 2.0],
      ["with", 2.2, 2.4], ["two", 2.4, 2.5], ["baths", 2.6, 3.0],
    ].map(([word, start, end]) => ({ word: word as string, start: start as number, end: end as number }));
    const words = alignWords("Offered at $525,000 with 2 baths.", heard, 1);
    expect(words.map((w) => w.text)).toEqual(["Offered", "at", "$525,000", "with", "2", "baths."]);
    expect(words[2]).toEqual({ text: "$525,000", start: 1.6, end: 3 });
    expect(words[5]!.start).toBe(3.6);
    const cues = buildCues(words);
    expect(cues).toHaveLength(1);
    expect(cues[0]!.start).toBe(1.1);
  });
  it("breaks lines at sentence ends and pauses", () => {
    const w = (text: string, start: number) => ({ text, start, end: start + 0.3 });
    const cues = buildCues([w("Hello", 0), w("there.", 0.3), w("A", 0.7), w("new", 1.0), w("home", 2.5)]);
    expect(cues.map((c) => c.words.map((x) => x.text).join(" "))).toEqual(["Hello there.", "A new", "home"]);
  });
});

const models = voiceModelsAvailable();
describe.skipIf(!models.tts || !models.asr)("voice engine (local models)", () => {
  it("speaks a script and hears it back with word times", () => {
    const script = "Welcome to 742 Evergreen Terrace. This home has 4 bedrooms and is offered at $525,000.";
    const n = synthesize(script, "am_michael", 1);
    expect(n.sampleRate).toBe(24000);
    expect(n.sentences).toHaveLength(2);
    expect(n.sentences[1]!.start).toBeGreaterThan(n.sentences[0]!.end);
    expect(n.seconds).toBeGreaterThan(3);
    const heard = transcribe(n.samples, n.sampleRate);
    const text = heard.map((h) => h.word).join(" ");
    expect(text).toMatch(/evergreen terrace/);
    expect(text).toMatch(/four bedrooms/);
    expect(text).toMatch(/five hundred twenty five thousand dollars/);
    const words = alignWords(script, heard);
    const second = words.find((w) => w.text === "This")!;
    expect(Math.abs(second.start - n.sentences[1]!.start)).toBeLessThan(0.3);
    expect(unknownWords("Welcome home")).toEqual([]);
  }, 120_000);
  it("slower speech takes longer", () => {
    const a = synthesize("A bright and open kitchen.", "af_heart", 1.2).seconds;
    const b = synthesize("A bright and open kitchen.", "af_heart", 0.8).seconds;
    expect(b).toBeGreaterThan(a * 1.2);
  }, 120_000);
});
