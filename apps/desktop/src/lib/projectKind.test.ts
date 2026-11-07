import { describe, expect, it } from "vitest";
import { languageFromPath } from "./highlight";
import {
  detectProjectKind,
  languageForFile,
  looksDjangoTemplate,
  runHintForProject,
  testCommandForDiagnostic,
  testCommandForPath,
} from "./projectKind";

describe("detectProjectKind", () => {
  it("prefers Next, then Vite/React, then Django", () => {
    expect(detectProjectKind(["package.json", "next.config.ts", "app/page.tsx"])).toEqual({
      kind: "next",
      label: "Next.js",
    });
    expect(detectProjectKind(["package.json", "vite.config.ts", "src/App.tsx"])).toEqual({
      kind: "react",
      label: "React (Vite)",
    });
    expect(detectProjectKind(["manage.py", "blog/models.py"])).toEqual({
      kind: "django",
      label: "Django",
    });
    expect(detectProjectKind(["package.json", "src/index.js"])).toEqual({
      kind: "node",
      label: "Node",
    });
    expect(
      detectProjectKind([
        "package.json",
        "src/index.js",
        "website/vite.config.ts",
        "website/src/App.tsx",
      ]),
    ).toEqual({ kind: "node", label: "Node" });
    expect(detectProjectKind(["pyproject.toml", "src/main.py"])).toEqual({
      kind: "python",
      label: "Python",
    });
  });
});

describe("languageForFile", () => {
  it("treats Django templates as django even when the suffix is html", () => {
    expect(looksDjangoTemplate("{% extends 'base.html' %}\n{{ title }}")).toBe(true);
    expect(
      languageForFile(
        "templates/home.html",
        "{% block content %}{% endblock %}",
        "django",
        languageFromPath,
      ),
    ).toBe("django");
    expect(
      languageForFile(
        "src/App.tsx",
        "export function App() { return <div /> }",
        "react",
        languageFromPath,
      ),
    ).toBe("tsx");
    expect(runHintForProject("django")).toBe("python manage.py runserver");
    expect(runHintForProject("react")).toBe("npm run dev");
    expect(testCommandForPath("src/app.test.ts", "node")).toBe("npx vitest run src/app.test.ts");
    expect(testCommandForPath("tests/test_models.py", "django")).toBe(
      "python -m pytest tests/test_models.py",
    );
    expect(testCommandForDiagnostic("src/app.ts", "vitest failed", "node")).toBe(
      "npx vitest run src/app.ts",
    );
  });
});
