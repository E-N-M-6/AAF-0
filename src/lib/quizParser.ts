/**
 * Advanced Smart Bulk Text Quiz Parser Engine
 * Handles unlimited text length, filters section headers, supports flexible numbering,
 * auto-categorizes question types (MCQ, True/False, Essay), and auto-detects correct answers
 * via multiple notation formats (summary lines, inline asterisks, inline indicators).
 */

export interface ParsedQuestionDraft {
  id: string;
  type: "choice" | "boolean" | "essay";
  questionText: string;
  options: [string, string, string, string]; // for choice
  correctAnswer: string; // "0"|"1"|"2"|"3" for choice, "true"|"false" for boolean, model answer for essay
  points: number;
  isCustomPoints?: boolean;
  modelAnswer?: string; // for essay
  warnings?: string[];
}

export interface ParseResult {
  questions: ParsedQuestionDraft[];
  totalParsed: number;
  mcqCount: number;
  trueFalseCount: number;
  essayCount: number;
  unparsedLines: string[];
  warnings: string[];
}

// Convert Eastern Arabic numerals (٠-٩) to Western (0-9)
export function normalizeArabicNumerals(str: string): string {
  return str.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632));
}

// Question header regex supporting Arabic and English numbering
// Examples: 1., 1-, 1), (1), [1], س1:, س 1:, س١:, السؤال الأول:, 1:
const QUESTION_NUMBER_REGEX = /^(?:(?:س(?:ؤال)?\s*[\d٠-٩]+[:\.\-]?)|(?:[\(\[\{]?[\d٠-٩]+[\)\]\}\.\-:])|(?:السؤال\s+(?:الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|الحادي\s+عشر|الثاني\s+عشر|الثالث\s+عشر|الرابع\s+عشر|الخامس\s+عشر|السادس\s+عشر|السابع\s+عشر|الثامن\s+عشر|التاسع\s+عشر|العشرون|[\d٠-٩]+)[:\.\-]?))\s*(.*)$/i;

// Regex patterns for letter-based option prefixes (A, B, C, D / أ، ب، ج، د)
const OPTION_PREFIX_A = /^[\s*✔]*(?:(?:\([أاإآAa]\))|(?:\[[أاإآAa]\])|(?:[أاإآAa][\)\.\:\-\/]))\s*(.*)$/;
const OPTION_PREFIX_B = /^[\s*✔]*(?:(?:\([بBb]\))|(?:\[[بBb]\])|(?:[بBb][\)\.\:\-\/]))\s*(.*)$/;
const OPTION_PREFIX_C = /^[\s*✔]*(?:(?:\([جCc]\))|(?:\[[جCc]\])|(?:[جCc][\)\.\:\-\/]))\s*(.*)$/;
const OPTION_PREFIX_D = /^[\s*✔]*(?:(?:\([دDd]\))|(?:\[[دDd]\])|(?:[دDd][\)\.\:\-\/]))\s*(.*)$/;

// Optional numeric option prefixes (1, 2, 3, 4)
const NUMERIC_OPT_A = /^[\s*✔]*(?:(?:\([1١]\))|(?:\[[1١]\])|(?:[1١][\)\.\:\-\/]))\s*(.*)$/;
const NUMERIC_OPT_B = /^[\s*✔]*(?:(?:\([2٢]\))|(?:\[[2٢]\])|(?:[2٢][\)\.\:\-\/]))\s*(.*)$/;
const NUMERIC_OPT_C = /^[\s*✔]*(?:(?:\([3٣]\))|(?:\[[3٣]\])|(?:[3٣][\)\.\:\-\/]))\s*(.*)$/;
const NUMERIC_OPT_D = /^[\s*✔]*(?:(?:\([4٤]\))|(?:\[[4٤]\])|(?:[4٤][\)\.\:\-\/]))\s*(.*)$/;

// Correct answer markers inside option lines (inline)
const CORRECT_ANSWER_MARKERS = /[\*✔]|\[x\]|\(صح\)|\(صحيحة\)|\(صحيح\)|\(الإجابة\s+الصحيحة\)|\(الاجابة\s+الصحيحة\)|\(صح\s*✔\)/i;

// Explicit answer summary lines following options
// e.g.: "الإجابة الصحيحة: ب", "الاجابة: ب", "الجواب: ب", "المفتاح: ب", "Answer: B", "الحل: 2"
const SUMMARY_ANSWER_REGEX = /^(?:(?:الإجابة|الاجابة|الجواب|المفتاح|الحل|حل\s+السؤال)(?:\s+الصحيحة|\s+النموذجية)?(?:\s+هي)?|Answer|Correct\s+Answer|Ans|Key)\s*[:=]\s*(.+)$/i;

// Explicit essay model answer regex
// e.g.: "نموذج الإجابة: ...", "الإجابة النموذجية: ...", "Model Answer: ..."
const ESSAY_ANSWER_REGEX = /^(?:(?:نموذج\s+الإجابة|الإجابة\s+النموذجية|الاجابة\s+النموذجية|نموذج\s+الحل|عناصر\s+الإجابة|Model\s+Answer))\s*[:=]\s*(.+)$/i;

// Section dividers & headers regex to filter out or detect section shifts
const SECTION_DIVIDER_REGEX = /^(?:[-=_*~]{3,}|\s*[-=_*~]{3,}.*?[-=_*~]{3,}\s*)$/;
const ESSAY_SECTION_HEADER_REGEX = /(?:الأسئلة\s+المقالية|القسم\s+المقالي|أسئلة\s+مقالية|مقالي|Essay\s+Questions)/i;
const TRUE_FALSE_SECTION_HEADER_REGEX = /(?:أسئلة\s+الصواب\s+والخطأ|صح\s+أم\s+خطأ|صح\s+وخطأ|صواب\s+أم\s+خطأ|True\s*[\/\-]?\s*False)/i;
const MCQ_SECTION_HEADER_REGEX = /(?:الاختيار\s+من\s+متعدد|اختيار\s+من\s+متعدد|أسئلة\s+الاختيارات|Multiple\s+Choice)/i;
const DECORATIVE_HEADER_REGEX = /^(?:(?:أول[اً|ا]|ثاني[اً|ا]|ثالث[اً|ا]|رابع[اً|ا]|خامس[اً|ا])\s*[:\.\-]|المراجع\s+الكتابية\s*[:\.\-]|ملاحظات\s*[:\.\-]|تعليمات\s*[:\.\-]|تنبيه\s*[:\.\-]|Section\s+\w+|Part\s+\w+)/i;

/**
 * Clean option string from correct-answer markers if present
 */
function cleanOptionText(text: string): string {
  return text
    .replace(CORRECT_ANSWER_MARKERS, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Determine if text represents a True value in True/False
 */
function isTrueValue(val: string): boolean {
  const norm = val.trim().toLowerCase();
  return (
    norm === "صح" ||
    norm === "صواب" ||
    norm === "صحيح" ||
    norm === "صحيحة" ||
    norm === "ص" ||
    norm === "true" ||
    norm === "t"
  );
}

/**
 * Determine if text represents a False value in True/False
 */
function isFalseValue(val: string): boolean {
  const norm = val.trim().toLowerCase();
  return (
    norm === "خطأ" ||
    norm === "خاطئ" ||
    norm === "غير صحيح" ||
    norm === "خاطئة" ||
    norm === "خ" ||
    norm === "false" ||
    norm === "f"
  );
}

/**
 * Parse an answer target (e.g. from "الإجابة الصحيحة: ب" or "الإجابة: صح")
 * into option index ("0", "1", "2", "3") or boolean ("true", "false")
 */
function resolveAnswerValue(
  rawTarget: string,
  options: { [key: number]: string }
): { choiceIndex?: string; booleanVal?: "true" | "false" } {
  let target = rawTarget.trim();
  // Strip parentheses or brackets around the answer: "(ب)" -> "ب"
  target = target.replace(/^[\(\[\{]/, "").replace(/[\)\]\}]$/, "").trim();

  // 1. Direct letter matching: أ -> 0, ب -> 1, ج -> 2, د -> 3
  if (/^[أاإآAa]$/i.test(target)) return { choiceIndex: "0", booleanVal: "true" };
  if (/^[بBb]$/i.test(target)) return { choiceIndex: "1", booleanVal: "false" };
  if (/^[جCc]$/i.test(target)) return { choiceIndex: "2" };
  if (/^[دDd]$/i.test(target)) return { choiceIndex: "3" };

  // 2. Direct numeric matching: 1 -> 0, 2 -> 1, 3 -> 2, 4 -> 3
  if (/^[1١]$/.test(target)) return { choiceIndex: "0", booleanVal: "true" };
  if (/^[2٢]$/.test(target)) return { choiceIndex: "1", booleanVal: "false" };
  if (/^[3٣]$/.test(target)) return { choiceIndex: "2" };
  if (/^[4٤]$/.test(target)) return { choiceIndex: "3" };

  // 3. Boolean keywords
  if (isTrueValue(target)) return { booleanVal: "true", choiceIndex: "0" };
  if (isFalseValue(target)) return { booleanVal: "false", choiceIndex: "1" };

  // 4. Exact or fuzzy match against option text
  for (let s = 0; s < 4; s++) {
    const optText = (options[s] || "").trim().toLowerCase();
    if (optText && (optText === target.toLowerCase() || optText.includes(target.toLowerCase()) || target.toLowerCase().includes(optText))) {
      return { choiceIndex: String(s) };
    }
  }

  return {};
}

/**
 * Expands lines that might contain inline options on a single line
 * e.g., "أ) خيار 1   ب) خيار 2   ج) خيار 3   د) خيار 4"
 */
function expandInlineOptions(lines: string[]): string[] {
  const result: string[] = [];
  const inlineOptionRegex = /(?:^|\s{2,}|\t)(?:[أاإآAa1١بBb2٢جCc3٣دDd4٤][\)\.\:\-]|(?:\([أاإآAa1١بBb2٢جCc3٣دDd4٤]\)))/g;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      result.push("");
      continue;
    }

    // Check if line contains multiple option markers
    const matches = Array.from(line.matchAll(inlineOptionRegex));
    if (matches.length >= 2) {
      const splitIndices = matches.map((m) => m.index ?? 0).sort((a, b) => a - b);
      const firstPart = line.substring(0, splitIndices[0]).trim();
      if (firstPart) {
        result.push(firstPart);
      }
      for (let i = 0; i < splitIndices.length; i++) {
        const start = splitIndices[i];
        const end = i + 1 < splitIndices.length ? splitIndices[i + 1] : line.length;
        const optChunk = line.substring(start, end).trim();
        if (optChunk) {
          result.push(optChunk);
        }
      }
    } else {
      result.push(line);
    }
  }

  return result;
}

interface RawQuestionBlock {
  sectionTypeHint: "choice" | "boolean" | "essay";
  questionTextLines: string[];
  options: { [key: number]: string };
  correctIndex: string;
  booleanAnswer: "true" | "false" | "";
  modelAnswer: string;
  rawLines: string[];
}

/**
 * Main Smart Bulk Text Parser
 */
export function parseBulkQuizText(
  rawText: string,
  defaultMcqPoints: number = 2,
  defaultTrueFalsePoints: number = 1,
  defaultEssayPoints: number = 5
): ParseResult {
  const normalized = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rawLines = normalized.split("\n");
  const lines = expandInlineOptions(rawLines);

  const parsedQuestions: ParsedQuestionDraft[] = [];
  const unparsedLines: string[] = [];
  const globalWarnings: string[] = [];

  const blocks: RawQuestionBlock[] = [];
  let currentBlock: RawQuestionBlock | null = null;
  let currentOptionSlot: number | null = null;
  let currentSectionType: "choice" | "boolean" | "essay" = "choice";

  const commitCurrentBlock = () => {
    if (currentBlock) {
      const qText = currentBlock.questionTextLines.join(" ").trim();
      const hasOptions = Object.keys(currentBlock.options).length > 0;
      const hasModelAnswer = Boolean(currentBlock.modelAnswer.trim());
      if (qText || hasOptions || hasModelAnswer) {
        blocks.push(currentBlock);
      }
      currentBlock = null;
      currentOptionSlot = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      // If we already have 4 options or model answer in current block, empty line can mark end of question
      if (currentBlock) {
        const optCount = Object.keys(currentBlock.options).length;
        if (optCount >= 4 || currentBlock.modelAnswer || currentBlock.sectionTypeHint === "essay") {
          commitCurrentBlock();
        }
      }
      continue;
    }

    // 1. Check if line is a decorative divider or section header
    if (SECTION_DIVIDER_REGEX.test(line)) {
      if (ESSAY_SECTION_HEADER_REGEX.test(line)) {
        commitCurrentBlock();
        currentSectionType = "essay";
        continue;
      }
      if (TRUE_FALSE_SECTION_HEADER_REGEX.test(line)) {
        commitCurrentBlock();
        currentSectionType = "boolean";
        continue;
      }
      if (MCQ_SECTION_HEADER_REGEX.test(line)) {
        commitCurrentBlock();
        currentSectionType = "choice";
        continue;
      }
      // Pure divider line: ignore
      continue;
    }

    // Check if line without dashes is a section heading
    if (ESSAY_SECTION_HEADER_REGEX.test(line) && line.length < 50) {
      commitCurrentBlock();
      currentSectionType = "essay";
      continue;
    }
    if (TRUE_FALSE_SECTION_HEADER_REGEX.test(line) && line.length < 50) {
      commitCurrentBlock();
      currentSectionType = "boolean";
      continue;
    }
    if (MCQ_SECTION_HEADER_REGEX.test(line) && line.length < 50) {
      commitCurrentBlock();
      currentSectionType = "choice";
      continue;
    }
    if (DECORATIVE_HEADER_REGEX.test(line)) {
      // Decorative instructions / references line: ignore
      continue;
    }

    // 2. Check for explicit essay model answer line: e.g. "نموذج الإجابة: ..."
    const essayMatch = line.match(ESSAY_ANSWER_REGEX);
    if (essayMatch) {
      if (!currentBlock) {
        currentBlock = {
          sectionTypeHint: "essay",
          questionTextLines: ["سؤال مقالي"],
          options: {},
          correctIndex: "",
          booleanAnswer: "",
          modelAnswer: essayMatch[1].trim(),
          rawLines: [line]
        };
      } else {
        currentBlock.sectionTypeHint = "essay";
        currentBlock.modelAnswer = essayMatch[1].trim();
        currentBlock.rawLines.push(line);
      }
      continue;
    }

    // 3. Check for explicit summary answer line: e.g. "الإجابة الصحيحة: ب"
    const summaryMatch = line.match(SUMMARY_ANSWER_REGEX);
    if (summaryMatch && currentBlock) {
      const rawAns = summaryMatch[1].trim();
      const resolved = resolveAnswerValue(rawAns, currentBlock.options);
      if (resolved.choiceIndex !== undefined) {
        currentBlock.correctIndex = resolved.choiceIndex;
      }
      if (resolved.booleanVal !== undefined) {
        currentBlock.booleanAnswer = resolved.booleanVal;
      }
      currentBlock.rawLines.push(line);
      continue;
    }

    // 4. Check if line is a Question Header (e.g. "1. ...", "س1: ...", "السؤال الأول: ...")
    const qMatch = line.match(QUESTION_NUMBER_REGEX);
    if (qMatch) {
      commitCurrentBlock();

      currentBlock = {
        sectionTypeHint: currentSectionType,
        questionTextLines: [qMatch[1] ? qMatch[1].trim() : line],
        options: {},
        correctIndex: "",
        booleanAnswer: "",
        modelAnswer: "",
        rawLines: [line]
      };
      currentOptionSlot = null;
      continue;
    }

    // 5. Check if line is an Option (A, B, C, D / أ، ب، ج، د)
    let optMatch: RegExpMatchArray | null = null;
    let slot = -1;

    if ((optMatch = line.match(OPTION_PREFIX_A))) {
      slot = 0;
    } else if ((optMatch = line.match(OPTION_PREFIX_B))) {
      slot = 1;
    } else if ((optMatch = line.match(OPTION_PREFIX_C))) {
      slot = 2;
    } else if ((optMatch = line.match(OPTION_PREFIX_D))) {
      slot = 3;
    } else if (currentBlock && (optMatch = line.match(NUMERIC_OPT_A))) {
      slot = 0;
    } else if (currentBlock && (optMatch = line.match(NUMERIC_OPT_B))) {
      slot = 1;
    } else if (currentBlock && (optMatch = line.match(NUMERIC_OPT_C))) {
      slot = 2;
    } else if (currentBlock && (optMatch = line.match(NUMERIC_OPT_D))) {
      slot = 3;
    }

    if (slot !== -1 && optMatch) {
      if (!currentBlock) {
        currentBlock = {
          sectionTypeHint: currentSectionType,
          questionTextLines: ["سؤال بدون عنوان"],
          options: {},
          correctIndex: "",
          booleanAnswer: "",
          modelAnswer: "",
          rawLines: [line]
        };
      }

      currentOptionSlot = slot;
      const isCorrect = CORRECT_ANSWER_MARKERS.test(line);
      const cleaned = cleanOptionText(optMatch[1] || "");
      currentBlock.options[slot] = cleaned;
      currentBlock.rawLines.push(line);

      if (isCorrect) {
        currentBlock.correctIndex = String(slot);
        if (slot === 0 && isTrueValue(cleaned)) currentBlock.booleanAnswer = "true";
        if (slot === 1 && isFalseValue(cleaned)) currentBlock.booleanAnswer = "false";
      }
      continue;
    }

    // 6. If inside an active block before options start: append line to question text
    if (currentBlock && Object.keys(currentBlock.options).length === 0 && !currentBlock.modelAnswer) {
      currentBlock.questionTextLines.push(line);
      currentBlock.rawLines.push(line);
      continue;
    }

    // 7. If currently inside an option slot: continuation line
    if (currentBlock && currentOptionSlot !== null && currentOptionSlot in currentBlock.options) {
      const isCorrect = CORRECT_ANSWER_MARKERS.test(line);
      const cleaned = cleanOptionText(line);
      currentBlock.options[currentOptionSlot] = (currentBlock.options[currentOptionSlot] + " " + cleaned).trim();
      if (isCorrect) {
        currentBlock.correctIndex = String(currentOptionSlot);
      }
      currentBlock.rawLines.push(line);
      continue;
    }

    // 8. If inside essay block: continuation line of model answer
    if (currentBlock && (currentBlock.sectionTypeHint === "essay" || currentBlock.modelAnswer)) {
      currentBlock.modelAnswer = (currentBlock.modelAnswer + " " + line).trim();
      currentBlock.rawLines.push(line);
      continue;
    }

    // 9. Check if this is an unnumbered question followed by options
    const nextLine = lines.slice(i + 1).find((l) => l.trim().length > 0);
    if (nextLine && OPTION_PREFIX_A.test(nextLine.trim())) {
      commitCurrentBlock();
      currentBlock = {
        sectionTypeHint: currentSectionType,
        questionTextLines: [line],
        options: {},
        correctIndex: "",
        booleanAnswer: "",
        modelAnswer: "",
        rawLines: [line]
      };
      currentOptionSlot = null;
      continue;
    }

    unparsedLines.push(line);
  }

  commitCurrentBlock();

  // Transform raw blocks into typed ParsedQuestionDraft
  for (let bIdx = 0; bIdx < blocks.length; bIdx++) {
    const block = blocks[bIdx];
    let questionText = block.questionTextLines.join(" ").trim();
    questionText = questionText.replace(QUESTION_NUMBER_REGEX, "$1").trim();
    if (!questionText) {
      questionText = `سؤال رقم ${bIdx + 1}`;
    }

    const opt0 = (block.options[0] || "").trim();
    const opt1 = (block.options[1] || "").trim();
    const opt2 = (block.options[2] || "").trim();
    const opt3 = (block.options[3] || "").trim();
    const optionCount = Object.keys(block.options).length;

    // Detect if this question is True / False:
    // Either section hint is boolean, or option 0 is صح/صواب and option 1 is خطأ
    const isExplicitTrueFalse =
      (isTrueValue(opt0) && isFalseValue(opt1)) ||
      (isFalseValue(opt0) && isTrueValue(opt1)) ||
      (block.sectionTypeHint === "boolean" && optionCount <= 2);

    // Detect if this question is Essay:
    // Either section hint is essay, or has model answer, or 0 options in essay context
    const isEssay = block.sectionTypeHint === "essay" || Boolean(block.modelAnswer.trim()) || (optionCount === 0 && block.sectionTypeHint !== "boolean");

    let questionType: "choice" | "boolean" | "essay" = "choice";
    let finalCorrectAnswer = "";
    let finalPoints = defaultMcqPoints;
    const warnings: string[] = [];

    if (isEssay) {
      questionType = "essay";
      finalPoints = defaultEssayPoints;
      finalCorrectAnswer = block.modelAnswer.trim() || block.correctIndex;
      if (!finalCorrectAnswer) {
        warnings.push("يرجى كتابة نموذج الإجابة للمراجعة والتقييم الذكي.");
      }
    } else if (isExplicitTrueFalse) {
      questionType = "boolean";
      finalPoints = defaultTrueFalsePoints;

      // Determine true or false answer
      if (block.booleanAnswer) {
        finalCorrectAnswer = block.booleanAnswer;
      } else if (block.correctIndex === "0") {
        finalCorrectAnswer = isTrueValue(opt0) ? "true" : "false";
      } else if (block.correctIndex === "1") {
        finalCorrectAnswer = isFalseValue(opt1) ? "false" : "true";
      } else {
        warnings.push("يرجى تحديد ما إذا كانت الإجابة صح أم خطأ.");
      }
    } else {
      // Standard Multiple Choice Question
      questionType = "choice";
      finalPoints = defaultMcqPoints;
      finalCorrectAnswer = block.correctIndex;

      if (!opt0 || !opt1 || !opt2 || !opt3) {
        const missingCount = [opt0, opt1, opt2, opt3].filter((o) => !o).length;
        warnings.push(`تم رصد ${4 - missingCount} خيارات فقط من أصل 4.`);
      }

      if (!finalCorrectAnswer) {
        warnings.push("لم يتم تحديد الإجابة الصحيحة تلقائياً (يرجى اختيارها من المعاينة).");
      }
    }

    parsedQuestions.push({
      id: "bulk_q_" + Date.now() + "_" + bIdx + "_" + Math.floor(Math.random() * 1000),
      type: questionType,
      questionText,
      options: [opt0, opt1, opt2, opt3],
      correctAnswer: finalCorrectAnswer,
      modelAnswer: block.modelAnswer.trim(),
      points: finalPoints,
      isCustomPoints: false,
      warnings: warnings.length > 0 ? warnings : undefined
    });
  }

  const mcqCount = parsedQuestions.filter((q) => q.type === "choice").length;
  const trueFalseCount = parsedQuestions.filter((q) => q.type === "boolean").length;
  const essayCount = parsedQuestions.filter((q) => q.type === "essay").length;

  return {
    questions: parsedQuestions,
    totalParsed: parsedQuestions.length,
    mcqCount,
    trueFalseCount,
    essayCount,
    unparsedLines,
    warnings: globalWarnings
  };
}

/**
 * 20 Comprehensive Sample Questions in Arabic for testing bulk import:
 * - 10 Multiple Choice Questions (with diverse answer notation: explicit summary line, inline *, inline (صح), etc.)
 * - 5 True / False Questions
 * - 5 Essay Questions with model answers
 */
export const SAMPLE_ARABIC_QUIZ_TEXT = `--- القسم الأول: أسئلة الاختيار من متعدد ---

1. من هو كاتب الإنجيل الثاني في العهد الجديد؟
* أ) القديس مرقس الرسول
ب) القديس لوقا الإنجيلي
ج) القديس متى الرسول
د) القديس يوحنا الحبيب

2- ما هو الحيوان الرمزي الذي يرمز لإنجيل القديس مرقس في الفن الكنسي؟
أ) الأسد *
ب) الثور
ج) الإنسان
د) النسر

3) أين أسس القديس مرقس أول كرسي رسولي له في مصر؟
أ) القاهرة
ب) الإسكندرية (صح)
ج) بابلون
د) طيبة

٤. من هو صانع الأحذية الذي آمن على يد القديس مرقس بعد شفاء يده؟
أ) كيرلس
ب) إنيانوس الإسكافي
ج) أثناسيوس
د) ديديموس
الإجابة الصحيحة: ب

5. ما هي العبارة الافتتاحية الشهيرة لإنجيل القديس مرقس؟
A) بدء إنجيل يسوع المسيح ابن الله
B) في البدء كان الكلمة
C) كتاب ميلاد يسوع المسيح
D) إذ كان كثيرون قد أخذوا
Correct Answer: A

س6: كم عدد الإصحاحات التي يحتوي عليها إنجيل القديس مرقس؟
أ) 28 إصحاح
ب) 24 إصحاح
ج) 16 إصحاح
د) 21 إصحاح
الجواب: ج

(7) في أي بيت تأسست أول كنيسة مسيحية في العالم وأقيم فيها الفصح الأخير؟
(أ) بيت قيافا
(ب) علية صهيون (بيت مارمرقس)
(ج) بيت زكا
(د) بيت لعازر
المفتاح: ب

8- ما هي المعجزة التي اشتهر بها القديس مرقس ووالده أرسطوبولس في طريق الأردن؟
* أ) ترويض الأسد واللبؤة باسم الرب يسوع
ب) شق نهر الأردن
ج) إنزال المطر بعد الجفاف
د) إطفاء نيران الأتون

9. في أي يوم من الشهور القبطية تعيد الكنيسة باستشهاد القديس مرقس الرسول؟
أ) 30 برمودة
ب) 1 توت
ج) 29 كيهك
د) 12 بؤونة
الإجابة: 30 برمودة

10. ما هو اللقب الكنسي الشهير الممنوح للقديس مرقس في الذكصولوجيات والتسبحة؟
أ) فم الذهب
ب) حامي الإيمان
ج) ناظر الإله الإنجيلي كاروز الديار المصرية (صحيحة)
د) كوكب البرية

--- القسم الثاني: أسئلة الصواب والخطأ ---

11. ولد القديس مرقس الرسول في مدينة القيروان بإقليم طرابلس الغرب (ليبيا).
* أ) صح
ب) خطأ

12- اسم القديس مرقس العبري الأصلي كان "يوحنا" ولقب بمرقس.
أ) صح
ب) خطأ
الإجابة الصحيحة: أ

13. استشهد القديس مرقس الرسول في مدينة أورشليم على يد الرومان.
أ) صح
ب) خطأ
الإجابة الصحيحة: خطأ

14) كان القديس مرقس أحد الرسل السبعين الذين اختارهم السيد المسيح وأرسلهم للخدمة.
أ) صح (صحيح)
ب) خطأ

س15: كتب القديس مرقس إنجيله باللغة القبطية أولاً ثم تُرجم للغات الأخرى.
أ) صح
* ب) خطأ

--- القسم الثالث: الأسئلة المقالية ---

16. ما هي أبرز إنجازات القديس مرقس في مدينة الإسكندرية ومصر؟
نموذج الإجابة: تأسيس الكنيسة المرقسية وتكريس القديس إنيانوس أسقفاً و3 كهنة و7 شمامسة، وتأسيس مدرسة الإسكندرية اللاهوتية لتثبيت المؤمنين والرد على الفلاسفة.

17- اذكر دور القديس مرقس في الرحلة التبشيرية الأولى مع القديسين بولس وبرنابا.
نموذج الإجابة: كان معاوناً وخادماً لهما ورافقهما في قبرص وبمفيلية، وأظهر أمانة في الخدمة قبل أن يعود إلى أورشليم لحضور المجمع الرسولي.

18. فسر لماذا يرمز القديس مرقس بالأسد في التقليد والرموز الإنجيلية الأربعة؟
الإجابة النموذجية: لأن إنجيله يبدأ بصوت صارخ في البرية مثل زئير الأسد في البرية، ولأنه يبرز سلطان وقوة المسيح الأسد الغالب من سبط يهوذا.

19. ما هو دور القديس مرقس في ليلة العشاء السري والصلب كما ورد في إنجيله؟
نموذج الإجابة: أقيم الفصح والعشاء السري في علية بيته، وهو الشاب الذي تبع المسيح متلففاً بإزار ليلة القبض عليه في بستان جثسيماني وتركه وهرب.

20. كيف انتهت حياة القديس مرقس الرسول ونال إكليل الشهادة بالإسكندرية؟
الإجابة النموذجية: وثب عليه عبدة الأوثان يوم عيد الفصح القبطي الذي وافق عيد سيرابيس، وجروه في شوارع الإسكندرية بالحبال حتى فاضت روحه ونال إكليل الاستشهاد عام 68م.`;
