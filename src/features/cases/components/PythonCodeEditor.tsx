import { useMemo, useRef } from "react";
import type { ChangeEvent, KeyboardEvent, UIEvent } from "react";
import type { ProcessingScriptDiagnostic } from "../case.types";

const PYTHON_KEYWORDS = new Set([
  "False",
  "None",
  "True",
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "case",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "match",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "try",
  "type",
  "while",
  "with",
  "yield",
]);

const PYTHON_BUILTINS = new Set([
  "abs",
  "all",
  "any",
  "bool",
  "dict",
  "enumerate",
  "filter",
  "float",
  "int",
  "len",
  "list",
  "map",
  "max",
  "min",
  "open",
  "print",
  "range",
  "reversed",
  "round",
  "set",
  "sorted",
  "str",
  "sum",
  "super",
  "tuple",
  "zip",
]);

type TokenKind = "builtin" | "comment" | "decorator" | "keyword" | "number" | "operator" | "string";

interface PythonToken {
  kind?: TokenKind;
  text: string;
}

interface PythonCodeEditorProps {
  value: string;
  diagnostics: ProcessingScriptDiagnostic[];
  onChange: (value: string) => void;
}

function isIdentifierStart(character: string | undefined) {
  return character !== undefined && /[A-Za-z_]/.test(character);
}

function isIdentifierPart(character: string | undefined) {
  return character !== undefined && /[A-Za-z0-9_]/.test(character);
}

function tokenizePython(source: string): PythonToken[] {
  const tokens: PythonToken[] = [];
  let index = 0;

  const push = (text: string, kind?: TokenKind) => {
    if (text) tokens.push({ text, kind });
  };

  while (index < source.length) {
    const character = source[index];

    if (/\s/.test(character)) {
      let end = index + 1;
      while (end < source.length && /\s/.test(source[end])) end += 1;
      push(source.slice(index, end));
      index = end;
      continue;
    }

    if (character === "#") {
      const end = source.indexOf("\n", index);
      const tokenEnd = end === -1 ? source.length : end;
      push(source.slice(index, tokenEnd), "comment");
      index = tokenEnd;
      continue;
    }

    if (character === '"' || character === "'") {
      const triple = source.slice(index, index + 3) === character.repeat(3);
      let end = index + (triple ? 3 : 1);
      while (end < source.length) {
        if (source[end] === "\\") {
          end = Math.min(source.length, end + 2);
          continue;
        }
        if (triple && source.slice(end, end + 3) === character.repeat(3)) {
          end += 3;
          break;
        }
        if (!triple && source[end] === character) {
          end += 1;
          break;
        }
        if (!triple && source[end] === "\n") break;
        end += 1;
      }
      push(source.slice(index, end), "string");
      index = end;
      continue;
    }

    const number = source
      .slice(index)
      .match(
        /^(?:0[xX][\dA-Fa-f_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?[\d_]+)?j?)/,
      )?.[0];
    if (number) {
      push(number, "number");
      index += number.length;
      continue;
    }

    if (character === "@" && isIdentifierStart(source[index + 1])) {
      let end = index + 2;
      while (isIdentifierPart(source[end]) || source[end] === ".") end += 1;
      push(source.slice(index, end), "decorator");
      index = end;
      continue;
    }

    if (isIdentifierStart(character)) {
      let end = index + 1;
      while (isIdentifierPart(source[end])) end += 1;
      const identifier = source.slice(index, end);
      const kind = PYTHON_KEYWORDS.has(identifier)
        ? "keyword"
        : PYTHON_BUILTINS.has(identifier)
          ? "builtin"
          : undefined;
      push(identifier, kind);
      index = end;
      continue;
    }

    if (/[+\-*/%@&|^~:=<>!.,()[\]{}]/.test(character)) {
      let end = index + 1;
      while (end < source.length && /[+\-*/%@&|^~:=<>!]/.test(source[end])) end += 1;
      push(source.slice(index, end), "operator");
      index = end;
      continue;
    }

    push(character);
    index += 1;
  }

  return tokens;
}

export function PythonCodeEditor({ value, diagnostics, onChange }: PythonCodeEditorProps) {
  const highlightRef = useRef<HTMLPreElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const tokens = useMemo(() => tokenizePython(value), [value]);

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    onChange(event.target.value);
  }

  function handleScroll(event: UIEvent<HTMLTextAreaElement>) {
    if (!highlightRef.current) return;
    highlightRef.current.scrollTop = event.currentTarget.scrollTop;
    highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const start = event.currentTarget.selectionStart;
    const end = event.currentTarget.selectionEnd;
    const indent = "    ";
    onChange(`${value.slice(0, start)}${indent}${value.slice(end)}`);
    requestAnimationFrame(() =>
      textareaRef.current?.setSelectionRange(start + indent.length, start + indent.length),
    );
  }

  return (
    <div className={`python-editor ${diagnostics.length > 0 ? "has-errors" : ""}`}>
      <pre ref={highlightRef} aria-hidden="true">
        <code>
          {tokens.map((token, index) => (
            <span
              key={`${index}-${token.kind ?? "plain"}`}
              className={token.kind ? `python-token--${token.kind}` : undefined}
            >
              {token.text}
            </span>
          ))}
          {value.endsWith("\n") ? " " : null}
        </code>
      </pre>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label="Python processing script source"
        aria-invalid={diagnostics.length > 0}
      />
    </div>
  );
}
