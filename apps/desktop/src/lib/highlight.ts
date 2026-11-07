const MAX_HIGHLIGHT_CHARS = 200_000;
const SNIPPET_CACHE_CHARS = 2_048;
const SNIPPET_CACHE_MAX = 4_096;
const snippetCache = new Map<string, string>();

function snippetKey(lang: string, code: string): string {
  return `${lang}\0${code}`;
}

function rememberSnippet(key: string, html: string): void {
  if (snippetCache.has(key)) snippetCache.delete(key);
  snippetCache.set(key, html);
  if (snippetCache.size <= SNIPPET_CACHE_MAX) return;
  const oldest = snippetCache.keys().next().value;
  if (typeof oldest === "string") snippetCache.delete(oldest);
}

type TokenKind = "kw" | "str" | "cm" | "num" | "fn" | "type" | "dec" | "bi" | "attr";

interface LangSpec {
  keywords: string[];
  builtins?: string[];
  lineComment?: string;
  blockComment?: [string, string];
  strings?: string[];
  tripleStrings?: string[];
  stringPrefixes?: string[];
  decorators?: boolean;
  interpolate?: boolean;
}

const CODE_LANGS = new Set([
  "js",
  "ts",
  "jsx",
  "tsx",
  "python",
  "go",
  "rust",
  "java",
  "csharp",
  "cpp",
  "c",
  "kotlin",
  "swift",
  "ruby",
  "php",
  "bash",
  "dart",
  "lua",
  "groovy",
  "jenkins",
  "powershell",
  "elixir",
  "scala",
  "prisma",
  "proto",
  "graphql",
]);

const DEF_KEYWORDS: Record<string, string[]> = {
  js: ["function"],
  ts: ["function"],
  jsx: ["function"],
  tsx: ["function"],
  python: ["def"],
  go: ["func"],
  rust: ["fn"],
  kotlin: ["fun"],
  swift: ["func"],
  ruby: ["def"],
  php: ["function"],
  bash: ["function"],
  dart: ["void"],
  lua: ["function"],
  groovy: ["def", "void"],
  jenkins: ["def", "void"],
  powershell: ["function"],
  elixir: ["def", "defp"],
  scala: ["def"],
  proto: ["rpc"],
};

const TYPE_KEYWORDS: Record<string, string[]> = {
  js: ["class"],
  ts: ["class", "interface", "enum", "type"],
  jsx: ["class"],
  tsx: ["class", "interface", "enum", "type"],
  python: ["class"],
  go: ["type", "struct", "interface"],
  rust: ["struct", "enum", "trait", "type", "impl"],
  java: ["class", "interface", "enum"],
  csharp: ["class", "interface", "struct", "enum"],
  cpp: ["class", "struct", "enum", "namespace"],
  c: ["struct", "enum", "union"],
  kotlin: ["class", "interface", "object"],
  swift: ["class", "struct", "enum", "protocol", "extension"],
  ruby: ["class", "module"],
  php: ["class", "interface", "trait", "namespace"],
  dart: ["class", "mixin", "enum", "extension", "typedef"],
  groovy: ["class", "interface", "enum", "trait"],
  jenkins: ["class", "interface", "enum", "trait"],
  powershell: ["class", "enum"],
  elixir: ["defmodule", "defprotocol", "defstruct"],
  scala: ["class", "object", "trait", "type"],
  prisma: ["model", "enum", "type", "view"],
  proto: ["message", "enum", "service"],
  graphql: ["type", "input", "enum", "interface", "union", "scalar"],
};

function prefixCases(parts: string[]): string[] {
  const out = new Set<string>();
  for (const part of parts) {
    const n = part.length;
    for (let mask = 0; mask < 1 << n; mask += 1) {
      let s = "";
      for (let i = 0; i < n; i += 1) {
        const ch = part[i]!;
        s += mask & (1 << i) ? ch.toUpperCase() : ch.toLowerCase();
      }
      out.add(s);
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

const PY_STRING_PREFIXES = prefixCases(["f", "r", "b", "u", "fr", "rf", "br", "rb"]);

const PYTHON_BUILTINS = [
  "self",
  "cls",
  "NotImplemented",
  "Ellipsis",
  "print",
  "len",
  "range",
  "str",
  "int",
  "float",
  "list",
  "dict",
  "set",
  "tuple",
  "bool",
  "bytes",
  "bytearray",
  "object",
  "type",
  "super",
  "property",
  "staticmethod",
  "classmethod",
  "enumerate",
  "zip",
  "map",
  "filter",
  "iter",
  "next",
  "open",
  "isinstance",
  "issubclass",
  "hasattr",
  "getattr",
  "setattr",
  "delattr",
  "callable",
  "sum",
  "min",
  "max",
  "abs",
  "round",
  "any",
  "all",
  "sorted",
  "reversed",
  "id",
  "vars",
  "dir",
  "repr",
  "hash",
  "format",
  "input",
  "Exception",
  "BaseException",
  "ValueError",
  "TypeError",
  "KeyError",
  "AttributeError",
  "RuntimeError",
  "StopIteration",
  "NotImplementedError",
  "AssertionError",
  "IndexError",
  "FileNotFoundError",
  "OSError",
  "ImportError",
  "NameError",
  "ZeroDivisionError",
];

const C_STRINGS = ['"', "'", "`"];

const JS_KEYWORDS = [
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "let",
  "new",
  "of",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
  "true",
  "false",
  "null",
  "undefined",
];

const TS_KEYWORDS = [
  ...JS_KEYWORDS,
  "type",
  "interface",
  "implements",
  "public",
  "private",
  "protected",
  "readonly",
  "enum",
  "namespace",
  "declare",
  "abstract",
  "satisfies",
  "keyof",
  "infer",
];

const C_COMMENTS: Pick<LangSpec, "lineComment" | "blockComment" | "strings"> = {
  lineComment: "//",
  blockComment: ["/*", "*/"],
  strings: C_STRINGS,
};

const SPECS: Record<string, LangSpec> = {
  js: { keywords: JS_KEYWORDS, ...C_COMMENTS },
  ts: { keywords: TS_KEYWORDS, ...C_COMMENTS },
  jsx: { keywords: JS_KEYWORDS, ...C_COMMENTS },
  tsx: { keywords: TS_KEYWORDS, ...C_COMMENTS },
  python: {
    keywords: [
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
      "False",
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
      "None",
      "nonlocal",
      "not",
      "or",
      "pass",
      "raise",
      "return",
      "True",
      "try",
      "while",
      "with",
      "yield",
    ],
    builtins: PYTHON_BUILTINS,
    lineComment: "#",
    strings: ['"', "'"],
    tripleStrings: ['"""', "'''"],
    stringPrefixes: PY_STRING_PREFIXES,
    decorators: true,
    interpolate: true,
  },
  go: {
    keywords: [
      "break",
      "case",
      "chan",
      "const",
      "continue",
      "default",
      "defer",
      "else",
      "fallthrough",
      "for",
      "func",
      "go",
      "goto",
      "if",
      "import",
      "interface",
      "map",
      "package",
      "range",
      "return",
      "select",
      "struct",
      "switch",
      "type",
      "var",
      "true",
      "false",
      "nil",
    ],
    ...C_COMMENTS,
  },
  rust: {
    keywords: [
      "as",
      "async",
      "await",
      "break",
      "const",
      "continue",
      "crate",
      "else",
      "enum",
      "extern",
      "false",
      "fn",
      "for",
      "if",
      "impl",
      "in",
      "let",
      "loop",
      "match",
      "mod",
      "move",
      "mut",
      "pub",
      "ref",
      "return",
      "self",
      "Self",
      "static",
      "struct",
      "super",
      "trait",
      "true",
      "type",
      "unsafe",
      "use",
      "where",
      "while",
      "dyn",
      "union",
      "macro_rules",
    ],
    ...C_COMMENTS,
  },
  java: {
    keywords: [
      "abstract",
      "assert",
      "boolean",
      "break",
      "byte",
      "case",
      "catch",
      "class",
      "const",
      "continue",
      "default",
      "do",
      "else",
      "enum",
      "extends",
      "final",
      "finally",
      "float",
      "for",
      "if",
      "implements",
      "import",
      "instanceof",
      "int",
      "interface",
      "long",
      "new",
      "package",
      "private",
      "protected",
      "public",
      "return",
      "static",
      "switch",
      "this",
      "throw",
      "throws",
      "try",
      "void",
      "while",
      "true",
      "false",
      "null",
    ],
    ...C_COMMENTS,
  },
  csharp: {
    keywords: [
      "abstract",
      "as",
      "async",
      "await",
      "base",
      "bool",
      "break",
      "byte",
      "case",
      "catch",
      "class",
      "const",
      "continue",
      "default",
      "do",
      "else",
      "enum",
      "event",
      "explicit",
      "extern",
      "false",
      "finally",
      "for",
      "foreach",
      "if",
      "in",
      "interface",
      "internal",
      "is",
      "namespace",
      "new",
      "null",
      "override",
      "private",
      "protected",
      "public",
      "return",
      "static",
      "struct",
      "switch",
      "this",
      "throw",
      "true",
      "try",
      "using",
      "var",
      "void",
      "while",
    ],
    ...C_COMMENTS,
  },
  cpp: {
    keywords: [
      "auto",
      "bool",
      "break",
      "case",
      "catch",
      "char",
      "class",
      "const",
      "continue",
      "default",
      "delete",
      "do",
      "double",
      "else",
      "enum",
      "explicit",
      "extern",
      "false",
      "float",
      "for",
      "if",
      "inline",
      "int",
      "long",
      "namespace",
      "new",
      "nullptr",
      "private",
      "protected",
      "public",
      "return",
      "sizeof",
      "static",
      "struct",
      "switch",
      "template",
      "this",
      "throw",
      "true",
      "try",
      "typedef",
      "typename",
      "union",
      "using",
      "virtual",
      "void",
      "while",
    ],
    ...C_COMMENTS,
  },
  c: {
    keywords: [
      "auto",
      "break",
      "case",
      "char",
      "const",
      "continue",
      "default",
      "do",
      "double",
      "else",
      "enum",
      "extern",
      "float",
      "for",
      "goto",
      "if",
      "inline",
      "int",
      "long",
      "register",
      "return",
      "short",
      "signed",
      "sizeof",
      "static",
      "struct",
      "switch",
      "typedef",
      "union",
      "unsigned",
      "void",
      "volatile",
      "while",
      "restrict",
      "bool",
      "_Bool",
      "_Atomic",
      "_Generic",
      "_Static_assert",
      "_Thread_local",
      "_Alignas",
      "_Alignof",
      "_Noreturn",
      "true",
      "false",
    ],
    ...C_COMMENTS,
  },
  kotlin: {
    keywords: [
      "as",
      "break",
      "class",
      "continue",
      "else",
      "false",
      "for",
      "fun",
      "if",
      "in",
      "interface",
      "is",
      "null",
      "object",
      "package",
      "return",
      "super",
      "this",
      "throw",
      "true",
      "try",
      "typealias",
      "val",
      "var",
      "when",
      "while",
    ],
    ...C_COMMENTS,
  },
  swift: {
    keywords: [
      "as",
      "async",
      "await",
      "break",
      "case",
      "catch",
      "class",
      "continue",
      "default",
      "defer",
      "else",
      "enum",
      "extension",
      "false",
      "for",
      "func",
      "guard",
      "if",
      "import",
      "in",
      "let",
      "nil",
      "return",
      "self",
      "struct",
      "switch",
      "throw",
      "true",
      "try",
      "var",
      "where",
      "while",
    ],
    ...C_COMMENTS,
  },
  ruby: {
    keywords: [
      "begin",
      "break",
      "case",
      "class",
      "def",
      "do",
      "else",
      "elsif",
      "end",
      "ensure",
      "false",
      "for",
      "if",
      "in",
      "module",
      "next",
      "nil",
      "redo",
      "rescue",
      "retry",
      "return",
      "self",
      "super",
      "then",
      "true",
      "unless",
      "until",
      "when",
      "while",
      "yield",
    ],
    lineComment: "#",
    strings: ['"', "'"],
  },
  php: {
    keywords: [
      "and",
      "array",
      "as",
      "break",
      "case",
      "catch",
      "class",
      "const",
      "continue",
      "default",
      "do",
      "echo",
      "else",
      "elseif",
      "empty",
      "endfor",
      "endif",
      "endwhile",
      "extends",
      "false",
      "foreach",
      "function",
      "if",
      "implements",
      "include",
      "isset",
      "namespace",
      "new",
      "null",
      "or",
      "private",
      "protected",
      "public",
      "require",
      "return",
      "static",
      "switch",
      "throw",
      "true",
      "try",
      "use",
      "var",
      "while",
    ],
    ...C_COMMENTS,
  },
  bash: {
    keywords: [
      "alias",
      "break",
      "case",
      "continue",
      "declare",
      "do",
      "done",
      "elif",
      "else",
      "esac",
      "eval",
      "exec",
      "export",
      "fi",
      "for",
      "function",
      "if",
      "in",
      "local",
      "readonly",
      "return",
      "select",
      "set",
      "shift",
      "source",
      "then",
      "trap",
      "unset",
      "until",
      "wait",
      "while",
    ],
    builtins: [
      "cd",
      "echo",
      "exit",
      "printf",
      "pwd",
      "read",
      "test",
      "true",
      "false",
      "command",
      "type",
    ],
    lineComment: "#",
    strings: ['"', "'"],
  },
  docker: {
    keywords: [
      "FROM",
      "RUN",
      "CMD",
      "COPY",
      "ADD",
      "WORKDIR",
      "ENV",
      "ARG",
      "EXPOSE",
      "ENTRYPOINT",
      "USER",
      "VOLUME",
      "LABEL",
    ],
    lineComment: "#",
    strings: ['"', "'"],
  },
  json: {
    keywords: ["true", "false", "null"],
    strings: ['"'],
  },
  yaml: {
    keywords: ["true", "false", "null", "yes", "no"],
    lineComment: "#",
    strings: ['"', "'"],
  },
  css: {
    keywords: ["important", "from", "to"],
    blockComment: ["/*", "*/"],
    strings: ['"', "'"],
  },
  scss: {
    keywords: ["important", "from", "to"],
    lineComment: "//",
    blockComment: ["/*", "*/"],
    strings: ['"', "'"],
  },
  less: {
    keywords: ["important", "from", "to"],
    lineComment: "//",
    blockComment: ["/*", "*/"],
    strings: ['"', "'"],
  },
  html: {
    keywords: [],
    blockComment: ["<!--", "-->"],
    strings: ['"', "'"],
  },
  django: {
    keywords: [
      "autoescape",
      "block",
      "comment",
      "csrf_token",
      "cycle",
      "elif",
      "else",
      "empty",
      "endautoescape",
      "endblock",
      "endcomment",
      "endfor",
      "endif",
      "endwith",
      "extends",
      "filter",
      "for",
      "if",
      "include",
      "load",
      "now",
      "spaceless",
      "static",
      "url",
      "verbatim",
      "with",
    ],
    blockComment: ["<!--", "-->"],
    strings: ['"', "'"],
  },
  sql: {
    keywords: [
      "add",
      "all",
      "alter",
      "and",
      "as",
      "asc",
      "between",
      "by",
      "case",
      "create",
      "delete",
      "desc",
      "distinct",
      "drop",
      "else",
      "end",
      "exists",
      "from",
      "group",
      "having",
      "in",
      "insert",
      "into",
      "is",
      "join",
      "left",
      "like",
      "limit",
      "not",
      "null",
      "on",
      "or",
      "order",
      "right",
      "select",
      "set",
      "table",
      "then",
      "union",
      "update",
      "values",
      "when",
      "where",
    ],
    lineComment: "--",
    blockComment: ["/*", "*/"],
    strings: ["'", '"'],
  },
  toml: {
    keywords: ["true", "false"],
    lineComment: "#",
    strings: ['"', "'"],
    tripleStrings: ['"""', "'''"],
  },
  xml: {
    keywords: [],
    blockComment: ["<!--", "-->"],
    strings: ['"', "'"],
  },
  ini: {
    keywords: ["true", "false", "null", "on", "off", "yes", "no"],
    lineComment: "#",
    strings: ['"', "'"],
  },
  gitignore: {
    keywords: [],
    lineComment: "#",
  },
  markdown: {
    keywords: [],
    lineComment: "#",
    blockComment: ["<!--", "-->"],
    strings: ['"', "'"],
  },
  graphql: {
    keywords: [
      "query",
      "mutation",
      "subscription",
      "type",
      "input",
      "enum",
      "interface",
      "union",
      "scalar",
      "schema",
      "extend",
      "implements",
      "fragment",
      "on",
      "directive",
      "true",
      "false",
      "null",
    ],
    lineComment: "#",
    strings: ['"'],
    tripleStrings: ['"""'],
  },
  proto: {
    keywords: [
      "syntax",
      "package",
      "import",
      "option",
      "message",
      "enum",
      "service",
      "rpc",
      "returns",
      "repeated",
      "optional",
      "required",
      "reserved",
      "oneof",
      "map",
      "stream",
      "true",
      "false",
      "to",
    ],
    ...C_COMMENTS,
  },
  hcl: {
    keywords: [
      "resource",
      "data",
      "variable",
      "output",
      "module",
      "provider",
      "locals",
      "terraform",
      "for_each",
      "count",
      "for",
      "in",
      "if",
      "else",
      "true",
      "false",
      "null",
    ],
    lineComment: "#",
    blockComment: ["/*", "*/"],
    strings: ['"', "'"],
  },
  lua: {
    keywords: [
      "and",
      "break",
      "do",
      "else",
      "elseif",
      "end",
      "false",
      "for",
      "function",
      "goto",
      "if",
      "in",
      "local",
      "nil",
      "not",
      "or",
      "repeat",
      "return",
      "then",
      "true",
      "until",
      "while",
    ],
    lineComment: "--",
    blockComment: ["--[[", "]]"],
    strings: ['"', "'"],
  },
  dart: {
    keywords: [
      "abstract",
      "as",
      "assert",
      "async",
      "await",
      "break",
      "case",
      "catch",
      "class",
      "const",
      "continue",
      "default",
      "do",
      "else",
      "enum",
      "extends",
      "extension",
      "false",
      "final",
      "finally",
      "for",
      "if",
      "implements",
      "import",
      "in",
      "is",
      "late",
      "mixin",
      "new",
      "null",
      "return",
      "static",
      "super",
      "switch",
      "this",
      "throw",
      "true",
      "try",
      "typedef",
      "var",
      "void",
      "while",
      "with",
      "yield",
    ],
    ...C_COMMENTS,
  },
  powershell: {
    keywords: [
      "begin",
      "break",
      "catch",
      "class",
      "continue",
      "data",
      "do",
      "dynamicparam",
      "else",
      "elseif",
      "end",
      "enum",
      "exit",
      "filter",
      "finally",
      "for",
      "foreach",
      "function",
      "if",
      "in",
      "param",
      "process",
      "return",
      "switch",
      "throw",
      "trap",
      "try",
      "until",
      "using",
      "while",
      "$true",
      "$false",
      "$null",
    ],
    lineComment: "#",
    blockComment: ["<#", "#>"],
    strings: ['"', "'"],
  },
  groovy: {
    keywords: [
      "as",
      "assert",
      "break",
      "case",
      "catch",
      "class",
      "const",
      "continue",
      "def",
      "default",
      "do",
      "else",
      "enum",
      "extends",
      "false",
      "finally",
      "for",
      "goto",
      "if",
      "implements",
      "import",
      "in",
      "instanceof",
      "interface",
      "new",
      "null",
      "package",
      "return",
      "static",
      "super",
      "switch",
      "this",
      "throw",
      "throws",
      "trait",
      "true",
      "try",
      "void",
      "while",
    ],
    ...C_COMMENTS,
  },
  jenkins: {
    keywords: [
      "as",
      "assert",
      "break",
      "case",
      "catch",
      "class",
      "const",
      "continue",
      "def",
      "default",
      "do",
      "else",
      "enum",
      "extends",
      "false",
      "finally",
      "for",
      "if",
      "implements",
      "import",
      "in",
      "instanceof",
      "interface",
      "new",
      "null",
      "package",
      "return",
      "static",
      "super",
      "switch",
      "this",
      "throw",
      "true",
      "try",
      "void",
      "while",
      "pipeline",
      "agent",
      "stages",
      "stage",
      "steps",
      "when",
      "post",
      "script",
      "parallel",
      "node",
      "checkout",
      "echo",
      "sh",
      "always",
      "success",
      "failure",
      "environment",
      "parameters",
      "options",
      "tools",
      "triggers",
      "input",
      "retry",
      "timeout",
      "docker",
      "dockerfile",
      "any",
      "none",
    ],
    ...C_COMMENTS,
  },
  prisma: {
    keywords: ["datasource", "generator", "model", "enum", "type", "view", "true", "false"],
    lineComment: "//",
    blockComment: ["/*", "*/"],
    strings: ['"'],
    decorators: true,
  },
  cmake: {
    keywords: [
      "if",
      "else",
      "elseif",
      "endif",
      "foreach",
      "endforeach",
      "while",
      "endwhile",
      "function",
      "endfunction",
      "macro",
      "endmacro",
      "set",
      "unset",
      "project",
      "include",
      "option",
      "return",
      "break",
      "continue",
      "true",
      "false",
      "on",
      "off",
    ],
    lineComment: "#",
    strings: ['"', "'"],
  },
  gomod: {
    keywords: ["module", "go", "require", "replace", "exclude", "retract", "toolchain"],
    lineComment: "//",
    strings: ['"'],
  },
  elixir: {
    keywords: [
      "alias",
      "and",
      "case",
      "cond",
      "def",
      "defp",
      "defmodule",
      "defprotocol",
      "defstruct",
      "do",
      "else",
      "end",
      "false",
      "fn",
      "for",
      "if",
      "import",
      "in",
      "nil",
      "not",
      "or",
      "quote",
      "raise",
      "receive",
      "require",
      "rescue",
      "true",
      "try",
      "unless",
      "use",
      "when",
    ],
    lineComment: "#",
    strings: ['"', "'"],
    tripleStrings: ['"""', "'''"],
    interpolate: true,
  },
  scala: {
    keywords: [
      "abstract",
      "case",
      "catch",
      "class",
      "def",
      "do",
      "else",
      "extends",
      "false",
      "final",
      "finally",
      "for",
      "forSome",
      "if",
      "implicit",
      "import",
      "lazy",
      "match",
      "new",
      "null",
      "object",
      "override",
      "package",
      "private",
      "protected",
      "return",
      "sealed",
      "super",
      "this",
      "throw",
      "trait",
      "true",
      "try",
      "type",
      "val",
      "var",
      "while",
      "with",
      "yield",
    ],
    ...C_COMMENTS,
  },
};

const ALIAS: Record<string, string> = {
  javascript: "js",
  typescript: "ts",
  tsx: "tsx",
  jsx: "jsx",
  django: "django",
  jinja: "django",
  jinja2: "django",
  mjs: "js",
  cjs: "js",
  mts: "ts",
  cts: "ts",
  py: "python",
  sh: "bash",
  zsh: "bash",
  fish: "bash",
  yml: "yaml",
  htm: "html",
  sass: "scss",
  pcss: "css",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  h: "c",
  cs: "csharp",
  kt: "kotlin",
  kts: "kotlin",
  rb: "ruby",
  rs: "rust",
  makefile: "bash",
  mk: "bash",
  svg: "xml",
  plist: "xml",
  env: "ini",
  properties: "ini",
  editorconfig: "ini",
  graphql: "graphql",
  gql: "graphql",
  protobuf: "proto",
  terraform: "hcl",
  tf: "hcl",
  ps1: "powershell",
  psm1: "powershell",
  pwsh: "powershell",
  gradle: "groovy",
  jenkins: "jenkins",
  jenkinsfile: "jenkins",
  md: "markdown",
  ex: "elixir",
  exs: "elixir",
};

const EXT: Record<string, string> = {
  ts: "ts",
  mts: "ts",
  cts: "ts",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  tsx: "tsx",
  js: "js",
  jsx: "jsx",
  mjs: "js",
  cjs: "js",
  py: "python",
  pyi: "python",
  pyw: "python",
  go: "go",
  rs: "rust",
  java: "java",
  rb: "ruby",
  php: "php",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  ksh: "bash",
  bashrc: "bash",
  zshrc: "bash",
  zshenv: "bash",
  zprofile: "bash",
  kshrc: "bash",
  json: "json",
  jsonc: "json",
  json5: "json",
  map: "json",
  ipynb: "json",
  yml: "yaml",
  yaml: "yaml",
  css: "css",
  pcss: "css",
  scss: "scss",
  sass: "scss",
  less: "less",
  html: "html",
  htm: "html",
  vue: "html",
  svelte: "html",
  astro: "html",
  jinja: "django",
  j2: "django",
  django: "django",
  sql: "sql",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  toml: "toml",
  xml: "xml",
  svg: "xml",
  plist: "xml",
  xsd: "xml",
  wsdl: "xml",
  xsl: "xml",
  xslt: "xml",
  csproj: "xml",
  fsproj: "xml",
  vbproj: "xml",
  resx: "xml",
  xib: "xml",
  storyboard: "xml",
  ini: "ini",
  env: "ini",
  cfg: "ini",
  conf: "ini",
  properties: "ini",
  editorconfig: "ini",
  gitconfig: "ini",
  npmrc: "ini",
  gitignore: "gitignore",
  dockerignore: "gitignore",
  npmignore: "gitignore",
  prettierignore: "gitignore",
  eslintignore: "gitignore",
  cursorignore: "gitignore",
  locusignore: "gitignore",
  graphql: "graphql",
  gql: "graphql",
  proto: "proto",
  tf: "hcl",
  tfvars: "hcl",
  hcl: "hcl",
  lua: "lua",
  dart: "dart",
  ps1: "powershell",
  psm1: "powershell",
  psd1: "powershell",
  groovy: "groovy",
  gradle: "groovy",
  jenkinsfile: "jenkins",
  prisma: "prisma",
  cmake: "cmake",
  ex: "elixir",
  exs: "elixir",
  scala: "scala",
  sc: "scala",
};

export function languageFromPath(path: string): string {
  const leaf = path.replace(/\\/g, "/").split("/").pop() ?? "";
  const lower = leaf.toLowerCase();
  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) return "docker";
  if (lower === "makefile" || lower === "gnumakefile") return "bash";
  if (
    lower === ".bashrc" ||
    lower === ".bash_profile" ||
    lower === ".bash_login" ||
    lower === ".bash_logout" ||
    lower === ".zshrc" ||
    lower === ".zshenv" ||
    lower === ".zprofile" ||
    lower === ".zlogin" ||
    lower === ".profile" ||
    lower === ".kshrc"
  ) {
    return "bash";
  }
  if (lower === ".env" || lower.startsWith(".env.")) return "ini";
  if (
    lower === "gemfile" ||
    lower === "rakefile" ||
    lower === "podfile" ||
    lower === "brewfile" ||
    lower === "vagrantfile"
  ) {
    return "ruby";
  }
  if (
    lower === "jenkinsfile" ||
    lower.startsWith("jenkinsfile.") ||
    lower.endsWith(".jenkinsfile")
  ) {
    return "jenkins";
  }
  if (lower === "cmakelists.txt") return "cmake";
  if (lower === "go.mod" || lower === "go.sum") return "gomod";
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return "";
  return EXT[lower.slice(dot + 1)] ?? "";
}

export function resolveLanguage(lang: string): string {
  const key = lang.trim().toLowerCase();
  if (!key) return "";
  return ALIAS[key] ?? (SPECS[key] ? key : "");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function wrap(kind: TokenKind, text: string): string {
  const attr = kind === "fn" || kind === "type" ? ` data-symbol="${escapeHtml(text)}"` : "";
  if (!text.includes("\n")) return `<span class="tok-${kind}"${attr}>${escapeHtml(text)}</span>`;
  return text
    .split("\n")
    .map((part) => {
      if (!part) return "";
      const partAttr = kind === "fn" || kind === "type" ? ` data-symbol="${escapeHtml(part)}"` : "";
      return `<span class="tok-${kind}"${partAttr}>${escapeHtml(part)}</span>`;
    })
    .join("\n");
}

/** Wrap lines after a whole-file highlight so added-line marks stay cheap. */
export function wrapHighlightLines(html: string, added: ReadonlySet<number>): string {
  if (!added.size) return html;
  return html
    .split("\n")
    .map((line, i) =>
      added.has(i + 1) ? `<span class="workspace-line add">${line || " "}</span>` : line,
    )
    .join("\n");
}

const FULL_HIGHLIGHT_CHARS = 120_000;
const FULL_HIGHLIGHT_LINES = 3_000;

export type HighlightDoc = {
  lang: string;
  lines: string[];
  html: string[];
};

function fileLines(code: string): string[] {
  return code.split("\n");
}

function highlightAllLines(code: string, lang: string): string[] {
  if (!code) return [""];
  return fileLines(highlightSource(code, lang));
}

/** Incremental whole-file highlight. Reuses unchanged line HTML across keystrokes. */
export function highlightDocument(
  code: string,
  lang: string,
  prev?: HighlightDoc | null,
  lines = fileLines(code),
): HighlightDoc {
  if (
    !prev ||
    prev.lang !== lang ||
    !prev.html.length ||
    code.length > FULL_HIGHLIGHT_CHARS ||
    lines.length > FULL_HIGHLIGHT_LINES
  ) {
    return { lang, lines, html: highlightAllLines(code, lang) };
  }
  let first = 0;
  const shared = Math.min(lines.length, prev.lines.length);
  while (first < shared && lines[first] === prev.lines[first]) first += 1;
  let lastNew = lines.length - 1;
  let lastOld = prev.lines.length - 1;
  while (lastNew >= first && lastOld >= first && lines[lastNew] === prev.lines[lastOld]) {
    lastNew -= 1;
    lastOld -= 1;
  }
  if (first > lastNew && lines.length === prev.lines.length) return prev;

  const changedHtml =
    lastNew >= first ? highlightAllLines(lines.slice(first, lastNew + 1).join("\n"), lang) : [];
  const html = new Array<string>(lines.length);
  let at = 0;
  for (let i = 0; i < first; i += 1, at += 1) html[at] = prev.html[i]!;
  for (const line of changedHtml) {
    html[at] = line;
    at += 1;
  }
  for (let i = lastOld + 1; i < prev.html.length; i += 1, at += 1) html[at] = prev.html[i]!;
  return { lang, lines, html };
}

export function visibleHighlightSlice(
  doc: HighlightDoc,
  startLine: number,
  endLine: number,
): { html: string; padLines: number; tailLines: number } {
  const n = Math.max(1, doc.html.length);
  const start = Math.max(0, Math.min(n, startLine - 1));
  const end = Math.max(start, Math.min(n, endLine));
  return {
    html: doc.html.slice(start, end).join("\n"),
    padLines: start,
    tailLines: n - end,
  };
}

/** Highlight the visible window. Large files skip a full-file HTML cache. */
export function highlightVisible(
  code: string,
  lang: string,
  startLine: number,
  endLine: number,
  prev?: HighlightDoc | null,
  lines?: string[],
): { doc: HighlightDoc; html: string; padLines: number; tailLines: number } {
  const file = lines ?? fileLines(code);
  const lineCount = Math.max(1, file.length);
  const start = Math.max(1, Math.min(startLine, lineCount));
  const end = Math.max(start, Math.min(endLine, lineCount));
  if (code.length > FULL_HIGHLIGHT_CHARS || lineCount > FULL_HIGHLIGHT_LINES) {
    const html = highlightSource(file.slice(start - 1, end).join("\n"), lang);
    return {
      doc: { lang, lines: file, html: [] },
      html,
      padLines: start - 1,
      tailLines: lineCount - end,
    };
  }
  const doc = highlightDocument(code, lang, prev, file);
  return { doc, ...visibleHighlightSlice(doc, start, end) };
}

function readEscapedString(code: string, start: number, quote: string): number {
  let i = start + quote.length;
  while (i < code.length) {
    const ch = code[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (quote.length > 1) {
      if (code.startsWith(quote, i)) return i + quote.length;
      i += 1;
      continue;
    }
    if (ch === quote) return i + 1;
    if (quote !== "`" && ch === "\n") return i;
    i += 1;
  }
  return code.length;
}

function skipSpace(code: string, i: number): number {
  while (i < code.length && (code[i] === " " || code[i] === "\t")) i += 1;
  return i;
}

function peekCall(code: string, i: number): boolean {
  return code[skipSpace(code, i)] === "(";
}

function peekYamlKey(code: string, i: number): boolean {
  const at = skipSpace(code, i);
  if (code[at] !== ":") return false;
  const next = code[at + 1];
  return (
    next === undefined ||
    next === " " ||
    next === "\t" ||
    next === "\n" ||
    next === "\r" ||
    next === "#" ||
    next === "," ||
    next === "}" ||
    next === "]"
  );
}

function atLineStart(code: string, i: number): boolean {
  let j = i;
  while (j > 0 && (code[j - 1] === " " || code[j - 1] === "\t")) j -= 1;
  return j === 0 || code[j - 1] === "\n";
}

function readHashDirective(code: string, start: number): number {
  let i = start + 1;
  i = skipSpace(code, i);
  if (!code[i] || !/[A-Za-z_]/.test(code[i]!)) return start;
  while (i < code.length && /[A-Za-z0-9_]/.test(code[i]!)) i += 1;
  return i;
}

function readRustAttribute(code: string, start: number): number {
  let i = start + 1;
  if (code[i] === "!") i += 1;
  if (code[i] !== "[") return start;
  let depth = 0;
  while (i < code.length) {
    const ch = code[i]!;
    if (ch === '"' || ch === "'") {
      i = readEscapedString(code, i, ch);
      continue;
    }
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      i += 1;
      if (depth === 0) return i;
      continue;
    }
    i += 1;
  }
  return code.length;
}

function isTypeName(word: string): boolean {
  if (word.length < 2 || !/^[A-Z]/.test(word) || /^[A-Z0-9_]+$/.test(word)) return false;
  return /^[A-Z][_A-Za-z0-9]*$/.test(word);
}

function stringOpenAt(
  code: string,
  i: number,
  spec: LangSpec,
): { prefix: string; quote: string } | undefined {
  let pos = i;
  let prefix = "";
  if (spec.stringPrefixes) {
    const found = spec.stringPrefixes.find((p) => code.startsWith(p, i));
    if (found) {
      prefix = found;
      pos = i + found.length;
    }
  }
  const triple = spec.tripleStrings?.find((q) => code.startsWith(q, pos));
  if (triple) return { prefix, quote: triple };
  const quote = spec.strings?.find((q) => code[pos] === q);
  if (quote) return { prefix, quote };
  return undefined;
}

function findMatchingBrace(code: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < code.length) {
    const ch = code[i]!;
    if (ch === "'" || ch === '"') {
      const triple = code.startsWith(ch + ch + ch, i) ? ch + ch + ch : ch;
      i = readEscapedString(code, i, triple);
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

function splitFormatSpec(inner: string): { expr: string; spec: string } {
  let depth = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i]!;
    if (ch === "'" || ch === '"') {
      const triple = inner.startsWith(ch + ch + ch, i) ? ch + ch + ch : ch;
      i = readEscapedString(inner, i, triple) - 1;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") depth = Math.max(0, depth - 1);
    else if (depth === 0 && (ch === ":" || (ch === "!" && /[sra]/i.test(inner[i + 1] ?? "")))) {
      return { expr: inner.slice(0, i), spec: inner.slice(i) };
    }
  }
  return { expr: inner, spec: "" };
}

function highlightInterpolatedString(raw: string, lang: string): string {
  let i = 0;
  while (i < raw.length && /[A-Za-z]/.test(raw[i]!)) i += 1;
  const triple = raw.startsWith('"""', i) || raw.startsWith("'''", i);
  const quote = raw.slice(i, i + (triple ? 3 : 1));
  if (!quote) return wrap("str", raw);
  let out = "";
  let buf = raw.slice(0, i + quote.length);
  i += quote.length;
  const flush = () => {
    if (!buf) return;
    out += wrap("str", buf);
    buf = "";
  };
  while (i < raw.length) {
    if (raw.startsWith(quote, i)) {
      flush();
      out += wrap("str", raw.slice(i));
      return out;
    }
    if (raw[i] === "{" && raw[i + 1] === "{") {
      buf += "{{";
      i += 2;
      continue;
    }
    if (raw[i] === "}" && raw[i + 1] === "}") {
      buf += "}}";
      i += 2;
      continue;
    }
    if (raw[i] === "{") {
      const close = findMatchingBrace(raw, i);
      if (close < 0) {
        buf += raw.slice(i);
        break;
      }
      flush();
      const { expr, spec } = splitFormatSpec(raw.slice(i + 1, close));
      out += wrap("str", "{");
      out += highlightSource(expr, lang);
      if (spec) out += wrap("str", spec);
      out += wrap("str", "}");
      i = close + 1;
      continue;
    }
    if (raw[i] === "\\") {
      buf += raw.slice(i, Math.min(i + 2, raw.length));
      i += 2;
      continue;
    }
    buf += raw[i];
    i += 1;
  }
  flush();
  return out;
}

function emitString(raw: string, spec: LangSpec, lang: string, prefix: string): string {
  if (spec.interpolate && /f/i.test(prefix)) return highlightInterpolatedString(raw, lang);
  return wrap("str", raw);
}

function readDecorator(code: string, start: number): number {
  let i = start + 1;
  while (i < code.length) {
    if (!/[A-Za-z_]/.test(code[i]!)) break;
    i += 1;
    while (i < code.length && /[A-Za-z0-9_]/.test(code[i]!)) i += 1;
    if (code[i] === ".") {
      i += 1;
      continue;
    }
    break;
  }
  return i;
}

type HighlighterSets = {
  keywords: Set<string>;
  builtins: Set<string>;
  defKw: Set<string>;
  typeKw: Set<string>;
  keywordsUpper?: Set<string>;
};

const CASE_INSENSITIVE = new Set(["sql", "docker", "powershell", "cmake"]);
const HIGHLIGHT_SETS = new Map<string, HighlighterSets>();

function highlighterSets(resolved: string, spec: LangSpec): HighlighterSets {
  const cached = HIGHLIGHT_SETS.get(resolved);
  if (cached) return cached;
  const sets: HighlighterSets = {
    keywords: new Set(spec.keywords),
    builtins: new Set(spec.builtins ?? []),
    defKw: new Set(DEF_KEYWORDS[resolved] ?? []),
    typeKw: new Set(TYPE_KEYWORDS[resolved] ?? []),
  };
  if (CASE_INSENSITIVE.has(resolved)) {
    sets.keywordsUpper = new Set(spec.keywords.map((item) => item.toUpperCase()));
  }
  HIGHLIGHT_SETS.set(resolved, sets);
  return sets;
}

const CSS_PSEUDO = new Set([
  "active",
  "after",
  "any-link",
  "autofill",
  "backdrop",
  "before",
  "checked",
  "cue",
  "default",
  "defined",
  "dir",
  "disabled",
  "empty",
  "enabled",
  "first",
  "first-child",
  "first-letter",
  "first-line",
  "first-of-type",
  "focus",
  "focus-visible",
  "focus-within",
  "fullscreen",
  "has",
  "host",
  "host-context",
  "hover",
  "in-range",
  "indeterminate",
  "invalid",
  "is",
  "lang",
  "last-child",
  "last-of-type",
  "left",
  "link",
  "marker",
  "modal",
  "not",
  "nth-child",
  "nth-last-child",
  "nth-last-of-type",
  "nth-of-type",
  "only-child",
  "only-of-type",
  "optional",
  "out-of-range",
  "placeholder",
  "placeholder-shown",
  "read-only",
  "read-write",
  "required",
  "right",
  "root",
  "scope",
  "selection",
  "slotted",
  "target",
  "target-text",
  "user-invalid",
  "user-valid",
  "valid",
  "visited",
  "where",
]);

const CSS_VALUES = new Set([
  "absolute",
  "all",
  "and",
  "auto",
  "block",
  "bold",
  "both",
  "border-box",
  "bottom",
  "center",
  "column",
  "contain",
  "content-box",
  "cover",
  "currentcolor",
  "dashed",
  "default",
  "dotted",
  "double",
  "end",
  "fixed",
  "flex",
  "flex-end",
  "flex-start",
  "from",
  "grid",
  "hidden",
  "important",
  "infinite",
  "inherit",
  "initial",
  "inline",
  "inline-block",
  "inline-flex",
  "inline-grid",
  "italic",
  "justify",
  "left",
  "max-content",
  "min-content",
  "none",
  "normal",
  "not",
  "nowrap",
  "only",
  "or",
  "pointer",
  "relative",
  "repeat",
  "revert",
  "revert-layer",
  "right",
  "row",
  "scroll",
  "solid",
  "space-around",
  "space-between",
  "space-evenly",
  "start",
  "static",
  "sticky",
  "stretch",
  "to",
  "top",
  "transparent",
  "underline",
  "unset",
  "visible",
  "wrap",
]);

const CSS_TAGS = new Set([
  "a",
  "article",
  "aside",
  "body",
  "button",
  "canvas",
  "code",
  "div",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "html",
  "img",
  "input",
  "label",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "path",
  "pre",
  "section",
  "span",
  "svg",
  "table",
  "tbody",
  "td",
  "textarea",
  "th",
  "thead",
  "tr",
  "ul",
  "video",
]);

function readCssIdentAt(code: string, i: number): number {
  if (code[i] === "-" && code[i + 1] === "-") {
    let j = i + 2;
    while (j < code.length && /[\w-]/.test(code[j]!)) j += 1;
    return j > i + 2 ? j : i;
  }
  if (code[i] === "-" && code[i + 1] && /[A-Za-z_]/.test(code[i + 1]!)) {
    let j = i + 1;
    while (j < code.length && /[\w-]/.test(code[j]!)) j += 1;
    return j;
  }
  if (!code[i] || !/[A-Za-z_]/.test(code[i]!)) return i;
  let j = i + 1;
  while (j < code.length && /[\w-]/.test(code[j]!)) j += 1;
  return j;
}

function readCssNumberAt(code: string, i: number): number {
  let j = i;
  if (code[j] === "+" || code[j] === "-") j += 1;
  const digitStart = j;
  if (code[j] === ".") {
    j += 1;
    if (!code[j] || !/[0-9]/.test(code[j]!)) return i;
    while (j < code.length && /[0-9]/.test(code[j]!)) j += 1;
  } else {
    if (!code[j] || !/[0-9]/.test(code[j]!)) return i;
    while (j < code.length && /[0-9]/.test(code[j]!)) j += 1;
    if (code[j] === ".") {
      j += 1;
      while (j < code.length && /[0-9]/.test(code[j]!)) j += 1;
    }
  }
  if (j === digitStart) return i;
  if (code[j] === "e" || code[j] === "E") {
    let k = j + 1;
    if (code[k] === "+" || code[k] === "-") k += 1;
    if (code[k] && /[0-9]/.test(code[k]!)) {
      j = k + 1;
      while (j < code.length && /[0-9]/.test(code[j]!)) j += 1;
    }
  }
  if (code[j] === "%") return j + 1;
  if (code[j] && /[A-Za-z]/.test(code[j]!)) {
    while (j < code.length && /[A-Za-z]/.test(code[j]!)) j += 1;
  }
  return j;
}

function peekCssColonKind(code: string, identEnd: number): "property" | "pseudo" | "none" {
  const colon = skipSpace(code, identEnd);
  if (code[colon] !== ":") return "none";
  if (code[colon + 1] === ":") return "pseudo";
  const after = skipSpace(code, colon + 1);
  const nameEnd = readCssIdentAt(code, after);
  if (nameEnd > after) {
    const name = code.slice(after, nameEnd).toLowerCase();
    if (CSS_PSEUDO.has(name)) return "pseudo";
  }
  return "property";
}

function readQuoted(code: string, i: number): number {
  const quote = code[i];
  if (quote !== '"' && quote !== "'") return i;
  return readEscapedString(code, i, quote);
}

function highlightCss(code: string, dialect: "css" | "scss" | "less"): string {
  let i = 0;
  let out = "";
  while (i < code.length) {
    if (code.startsWith("/*", i)) {
      const close = code.indexOf("*/", i + 2);
      const end = close < 0 ? code.length : close + 2;
      out += wrap("cm", code.slice(i, end));
      i = end;
      continue;
    }
    if (dialect !== "css" && code.startsWith("//", i)) {
      let end = code.indexOf("\n", i);
      if (end < 0) end = code.length;
      out += wrap("cm", code.slice(i, end));
      i = end;
      continue;
    }
    if (dialect === "scss" && code.startsWith("#{", i)) {
      const close = findMatchingBrace(code, i + 1);
      out += wrap("dec", "#{");
      if (close < 0) {
        i += 2;
        continue;
      }
      out += highlightCss(code.slice(i + 2, close), dialect);
      out += wrap("dec", "}");
      i = close + 1;
      continue;
    }
    if (dialect === "less" && code.startsWith("@{", i)) {
      const close = code.indexOf("}", i + 2);
      const end = close < 0 ? code.length : close + 1;
      out += wrap("dec", code.slice(i, end));
      i = end;
      continue;
    }
    if (code[i] === '"' || code[i] === "'") {
      const end = readQuoted(code, i);
      out += wrap("str", code.slice(i, end));
      i = end;
      continue;
    }
    if (code[i] === "@") {
      const end = readCssIdentAt(code, i + 1);
      if (end > i + 1) {
        out += wrap("dec", code.slice(i, end));
        i = end;
        continue;
      }
    }
    if (code[i] === "#" && code[i + 1] && /[0-9a-fA-F]/.test(code[i + 1]!)) {
      let j = i + 1;
      while (j < code.length && /[0-9a-fA-F]/.test(code[j]!)) j += 1;
      const n = j - i - 1;
      if (n === 3 || n === 4 || n === 6 || n === 8) {
        out += wrap("num", code.slice(i, j));
        i = j;
        continue;
      }
    }
    if (code[i] === "#" && code[i + 1] && /[A-Za-z_-]/.test(code[i + 1]!)) {
      const end = readCssIdentAt(code, i + 1);
      if (end > i + 1) {
        out += wrap("type", code.slice(i, end));
        i = end;
        continue;
      }
    }
    if (code[i] === "." && code[i + 1] && /[A-Za-z_-]/.test(code[i + 1]!)) {
      const end = readCssIdentAt(code, i + 1);
      if (end > i + 1) {
        out += wrap("type", code.slice(i, end));
        i = end;
        continue;
      }
    }
    if (code[i] === "$" && dialect !== "css" && code[i + 1] && /[A-Za-z_-]/.test(code[i + 1]!)) {
      const end = readCssIdentAt(code, i + 1);
      if (end > i + 1) {
        out += wrap("dec", code.slice(i, end));
        i = end;
        continue;
      }
    }
    if (code[i] === "!" && /^important\b/i.test(code.slice(i + 1, i + 11))) {
      const end = i + 1 + "important".length;
      out += wrap("kw", code.slice(i, end));
      i = end;
      continue;
    }
    if (code[i] === ":") {
      const dbl = code[i + 1] === ":";
      const nameAt = i + (dbl ? 2 : 1);
      const end = readCssIdentAt(code, nameAt);
      if (end > nameAt) {
        const name = code.slice(nameAt, end).toLowerCase();
        if (dbl || CSS_PSEUDO.has(name) || code[skipSpace(code, end)] === "(") {
          out += wrap("kw", code.slice(i, end));
          i = end;
          continue;
        }
      }
    }
    if (code[i] === "&" && dialect !== "css") {
      out += wrap("kw", "&");
      i += 1;
      continue;
    }
    const numEnd = readCssNumberAt(code, i);
    if (numEnd > i) {
      out += wrap("num", code.slice(i, numEnd));
      i = numEnd;
      continue;
    }
    if (code[i] === "-" && code[i + 1] === "-") {
      const end = readCssIdentAt(code, i);
      if (end > i) {
        out += wrap("dec", code.slice(i, end));
        i = end;
        continue;
      }
    }
    const identEnd = readCssIdentAt(code, i);
    if (identEnd > i) {
      const word = code.slice(i, identEnd);
      const lower = word.toLowerCase();
      const next = skipSpace(code, identEnd);
      if (code[next] === "(") {
        out += wrap("fn", word);
        i = identEnd;
        if (lower === "url") {
          out += escapeHtml("(");
          const inner = skipSpace(code, next + 1);
          if (code[inner] === '"' || code[inner] === "'") {
            const quoted = readQuoted(code, inner);
            out += wrap("str", code.slice(inner, quoted));
            const close = skipSpace(code, quoted);
            if (code[close] === ")") {
              out += escapeHtml(code.slice(quoted, close + 1));
              i = close + 1;
            } else {
              out += escapeHtml(code.slice(quoted, close));
              i = close;
            }
          } else {
            let close = inner;
            while (close < code.length && code[close] !== ")" && code[close] !== "\n") close += 1;
            out += wrap("str", code.slice(inner, close));
            if (code[close] === ")") {
              out += escapeHtml(")");
              i = close + 1;
            } else i = close;
          }
        }
        continue;
      }
      const colonKind = peekCssColonKind(code, identEnd);
      if (colonKind === "property") {
        out += wrap("attr", word);
        i = identEnd;
        continue;
      }
      if (colonKind === "pseudo" || CSS_TAGS.has(lower)) {
        out += wrap("kw", word);
        i = identEnd;
        continue;
      }
      if (CSS_VALUES.has(lower)) {
        out += wrap("kw", word);
        i = identEnd;
        continue;
      }
      out += escapeHtml(word);
      i = identEnd;
      continue;
    }
    out += escapeHtml(code[i]!);
    i += 1;
  }
  return out;
}

function styleLangFromAttrs(attrs: string): "css" | "scss" | "less" {
  const hit = attrs.match(/\blang\s*=\s*["']?\s*(scss|sass|less|css)\b/i);
  const lang = hit?.[1]?.toLowerCase();
  if (lang === "less") return "less";
  if (lang === "scss" || lang === "sass") return "scss";
  return "css";
}

function htmlTagClose(code: string, start: number): number {
  let i = start;
  while (i < code.length) {
    const ch = code[i]!;
    if (ch === '"' || ch === "'") {
      i = readQuoted(code, i);
      continue;
    }
    if (ch === ">") return i + 1;
    i += 1;
  }
  return code.length;
}

function atHtmlStyleOpen(code: string, i: number): boolean {
  if (code[i] !== "<") return false;
  return /^style(?:[\s>/]|$)/i.test(code.slice(i + 1, i + 7));
}

function highlightHtmlStyleBlock(
  code: string,
  start: number,
  host: string,
): { html: string; end: number } {
  const tagEnd = htmlTagClose(code, start);
  const open = code.slice(start, tagEnd);
  const gt = open.lastIndexOf(">");
  const styleAt = open.toLowerCase().indexOf("style");
  const attrs = gt >= 0 && styleAt >= 0 ? open.slice(styleAt + 5, gt) : "";
  const dialect = styleLangFromAttrs(attrs);
  let html = "";
  html += escapeHtml("<");
  html += wrap("kw", open.slice(1, 6));
  html += highlightSourceInner(open.slice(6, gt >= 0 ? gt : open.length), host);
  if (gt >= 0) html += escapeHtml(">");
  const close = code.slice(tagEnd).search(/<\/style\s*>/i);
  if (close < 0) {
    html += highlightCss(code.slice(tagEnd), dialect);
    return { html, end: code.length };
  }
  html += highlightCss(code.slice(tagEnd, tagEnd + close), dialect);
  const closeTok = code.slice(tagEnd + close).match(/^<\/style\s*>/i)?.[0] ?? "</style>";
  html += escapeHtml("</");
  html += wrap("kw", "style");
  html += escapeHtml(closeTok.slice("</style".length));
  return { html, end: tagEnd + close + closeTok.length };
}

function isStyleAttributeQuote(code: string, i: number): boolean {
  const quote = code[i];
  if (quote !== '"' && quote !== "'") return false;
  let j = i - 1;
  while (j >= 0 && (code[j] === " " || code[j] === "\t" || code[j] === "\n" || code[j] === "\r")) {
    j -= 1;
  }
  if (code[j] !== "=") return false;
  j -= 1;
  while (j >= 0 && (code[j] === " " || code[j] === "\t")) j -= 1;
  const word = "style";
  for (let k = word.length - 1; k >= 0; k -= 1, j -= 1) {
    if (j < 0 || code[j]!.toLowerCase() !== word[k]) return false;
  }
  return j < 0 || !/[A-Za-z0-9:_-]/.test(code[j]!);
}

export function highlightSource(code: string, lang: string): string {
  if (!code) return "";
  if (code.length > MAX_HIGHLIGHT_CHARS) return escapeHtml(code);
  const cacheable = code.length <= SNIPPET_CACHE_CHARS;
  if (cacheable) {
    const key = snippetKey(lang, code);
    const hit = snippetCache.get(key);
    if (hit !== undefined) {
      rememberSnippet(key, hit);
      return hit;
    }
  }
  const html = highlightSourceInner(code, lang);
  if (cacheable) rememberSnippet(snippetKey(lang, code), html);
  return html;
}

function highlightSourceInner(code: string, lang: string): string {
  const resolved = resolveLanguage(lang);
  if (resolved === "css" || resolved === "scss" || resolved === "less") {
    return highlightCss(code, resolved);
  }
  const spec = resolved ? SPECS[resolved] : undefined;
  if (!spec) return escapeHtml(code);
  const sets = highlighterSets(resolved, spec);
  const { keywords, builtins, defKw, typeKw } = sets;
  const rich = CODE_LANGS.has(resolved);
  const caseInsensitive = CASE_INSENSITIVE.has(resolved);
  let i = 0;
  let out = "";
  let expectName: "fn" | "type" | null = null;
  let afterDot = false;
  while (i < code.length) {
    if (spec.blockComment && code.startsWith(spec.blockComment[0], i)) {
      const close = code.indexOf(spec.blockComment[1], i + spec.blockComment[0].length);
      const end = close < 0 ? code.length : close + spec.blockComment[1].length;
      out += wrap("cm", code.slice(i, end));
      i = end;
      expectName = null;
      afterDot = false;
      continue;
    }
    if (spec.lineComment && code.startsWith(spec.lineComment, i)) {
      let end = code.indexOf("\n", i);
      if (end < 0) end = code.length;
      out += wrap("cm", code.slice(i, end));
      i = end;
      expectName = null;
      afterDot = false;
      continue;
    }
    if (spec.decorators && code[i] === "@") {
      const end = readDecorator(code, i);
      if (end > i + 1) {
        out += wrap("dec", code.slice(i, end));
        i = end;
        expectName = null;
        afterDot = false;
        continue;
      }
    }
    if ((resolved === "c" || resolved === "cpp") && code[i] === "#" && atLineStart(code, i)) {
      const end = readHashDirective(code, i);
      if (end > i + 1) {
        out += wrap("dec", code.slice(i, end));
        i = end;
        expectName = null;
        afterDot = false;
        continue;
      }
    }
    if (resolved === "rust" && code[i] === "#") {
      const end = readRustAttribute(code, i);
      if (end > i) {
        out += wrap("dec", code.slice(i, end));
        i = end;
        expectName = null;
        afterDot = false;
        continue;
      }
    }
    if (resolved === "django" && code.startsWith("{#", i)) {
      const close = code.indexOf("#}", i + 2);
      const end = close < 0 ? code.length : close + 2;
      out += wrap("cm", code.slice(i, end));
      i = end;
      expectName = null;
      afterDot = false;
      continue;
    }
    if (resolved === "django" && (code.startsWith("{%", i) || code.startsWith("{{", i))) {
      const open = code.slice(i, i + 2);
      const closeTok = open === "{%" ? "%}" : "}}";
      const found = code.indexOf(closeTok, i + 2);
      const end = found < 0 ? code.length : found + 2;
      const inner = code.slice(i + 2, found < 0 ? code.length : found);
      out += wrap("dec", open);
      out += highlightSourceInner(inner, open === "{{" ? "python" : "django");
      if (found >= 0) out += wrap("dec", closeTok);
      i = end;
      expectName = null;
      afterDot = false;
      continue;
    }
    if (
      (resolved === "html" || resolved === "xml" || resolved === "django") &&
      isStyleAttributeQuote(code, i)
    ) {
      const end = readQuoted(code, i);
      const innerEnd = code[end - 1] === code[i] ? end - 1 : end;
      out += wrap("str", code[i]!);
      out += highlightCss(code.slice(i + 1, innerEnd), "css");
      if (innerEnd < end) out += wrap("str", code[innerEnd]!);
      i = end;
      expectName = null;
      afterDot = false;
      continue;
    }
    const opened = stringOpenAt(code, i, spec);
    if (opened && (!opened.prefix || code.startsWith(opened.quote, i + opened.prefix.length))) {
      const quoteAt = i + opened.prefix.length;
      const end = readEscapedString(code, quoteAt, opened.quote);
      out += emitString(code.slice(i, end), spec, resolved, opened.prefix);
      i = end;
      expectName = null;
      afterDot = false;
      continue;
    }
    if (code[i] && /[0-9]/.test(code[i]!)) {
      let end = i + 1;
      while (end < code.length && /[0-9_.xXa-fA-F]/.test(code[end]!)) end += 1;
      out += wrap("num", code.slice(i, end));
      i = end;
      expectName = null;
      afterDot = false;
      continue;
    }
    if (
      (resolved === "html" || resolved === "xml" || resolved === "django") &&
      atHtmlStyleOpen(code, i)
    ) {
      const block = highlightHtmlStyleBlock(code, i, resolved);
      out += block.html;
      i = block.end;
      expectName = null;
      afterDot = false;
      continue;
    }
    if (
      (resolved === "html" ||
        resolved === "xml" ||
        resolved === "django" ||
        resolved === "jsx" ||
        resolved === "tsx") &&
      code[i] === "<" &&
      (code[i + 1] === "/" || code[i + 1] === ">" || /[A-Za-z]/.test(code[i + 1] ?? ""))
    ) {
      let end = i + 1;
      if (code[end] === "/") end += 1;
      const nameStart = end;
      while (end < code.length && /[A-Za-z0-9:_-]/.test(code[end]!)) end += 1;
      if (end > nameStart || code[nameStart] === ">") {
        out += `${escapeHtml(code.slice(i, nameStart))}${
          end > nameStart ? wrap("kw", code.slice(nameStart, end)) : ""
        }`;
        i = end;
        continue;
      }
    }
    if (code[i] && /[A-Za-z_$]/.test(code[i]!)) {
      let end = i + 1;
      while (
        end < code.length &&
        (/[A-Za-z0-9_$]/.test(code[end]!) || (resolved === "yaml" && code[end] === "-"))
      ) {
        end += 1;
      }
      const word = code.slice(i, end);
      const key = caseInsensitive ? word.toUpperCase() : word;
      const hit = caseInsensitive ? sets.keywordsUpper!.has(key) : keywords.has(word);
      if (hit) {
        out += wrap("kw", word);
        expectName = defKw.has(word) ? "fn" : typeKw.has(word) ? "type" : null;
        afterDot = false;
        i = end;
        continue;
      }
      let kind: TokenKind | "" = "";
      if (expectName) {
        kind = expectName;
        expectName = null;
      } else if (rich && afterDot) kind = peekCall(code, end) ? "fn" : "attr";
      else if (builtins.has(word)) kind = "bi";
      else if (resolved === "yaml" && peekYamlKey(code, end)) kind = "attr";
      else if (rich && isTypeName(word)) kind = "type";
      else if (rich && peekCall(code, end)) kind = "fn";
      out += kind ? wrap(kind, word) : escapeHtml(word);
      afterDot = false;
      i = end;
      continue;
    }
    if (code[i] === ".") afterDot = true;
    else if (code[i] === "\n") {
      expectName = null;
      afterDot = false;
    } else if (code[i] !== " " && code[i] !== "\t") {
      if (code[i] !== "(" && code[i] !== "[" && code[i] !== ",") expectName = null;
      if (code[i] !== "(") afterDot = false;
    }
    out += escapeHtml(code[i]!);
    i += 1;
  }
  return out;
}
