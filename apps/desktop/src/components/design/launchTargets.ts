import type { AgentRuntime } from "@locus/shared";
import { unityProjectPrompt } from "./unityProjectPrompt";
import { godotProjectPrompt } from "./godotProjectPrompt";
import { unrealProjectPrompt } from "./unrealProjectPrompt";
import { blenderProjectPrompt } from "./blenderProjectPrompt";

/** Where a Games / Assets launch builds: the HTML canvas, or a native tool on the Host. */
export type NativeEngine = "unity" | "godot" | "unreal" | "blender";
export type LaunchTarget = "web" | NativeEngine;
export type ProjectAction = "create" | "edit";
export type TargetSurface = "game" | "assets";

export type LaunchTargetOption = {
  id: LaunchTarget;
  title: string;
  /** One line under the title: what it produces and where it runs. */
  detail: string;
};

export type NativeStarter = { id: string; title: string; prompt: string };

type ActionCopy = {
  label: string;
  /** What the selected Host folder must be for this action. */
  folder: string;
  placeholder: string;
  createLabel: string;
  starters: NativeStarter[];
};

export type NativeEngineInfo = {
  id: NativeEngine;
  name: string;
  playbook: string;
  heading: string;
  lead: string;
  /** What has to be installed locally. */
  requires: string;
  actions: Record<ProjectAction, ActionCopy>;
};

export const LAUNCH_TARGETS: Record<TargetSurface, LaunchTargetOption[]> = {
  game: [
    { id: "web", title: "Web game", detail: "Plays in the canvas" },
    { id: "unity", title: "Unity", detail: "C# project on this machine" },
    { id: "godot", title: "Godot", detail: "Godot 4 project on this machine" },
    { id: "unreal", title: "Unreal", detail: "Unreal Engine 5 project on this machine" },
  ],
  assets: [
    { id: "web", title: "Web asset", detail: "Sprites, SVG and GLB in the canvas" },
    { id: "blender", title: "Blender", detail: ".blend files on this machine" },
  ],
};

export const NATIVE_ENGINES: Record<NativeEngine, NativeEngineInfo> = {
  unity: {
    id: "unity",
    name: "Unity",
    playbook: "LOCUS_UNITY_WORKFLOW",
    heading: "What should we build in Unity?",
    lead: "A Host coding agent creates or edits a real Unity project, then compiles, tests and builds it with your Unity Editor.",
    requires: "Unity Editor installed (via Unity Hub)",
    actions: {
      create: {
        label: "New project",
        folder: "A writable parent folder — the project is created in a new child folder",
        placeholder: "Describe the Unity 3D project to create…",
        createLabel: "Create Unity project",
        starters: [
          {
            id: "unity-third-person",
            title: "Third-person controller",
            prompt:
              "A third-person character controller with a follow camera, jump and sprint, on a small test level with ramps, stairs and collectable pickups.",
          },
          {
            id: "unity-physics",
            title: "Physics sandbox",
            prompt:
              "A physics sandbox scene: spawn boxes, spheres and ragdolls with the mouse, a slow-motion toggle and a reset key.",
          },
          {
            id: "unity-arena",
            title: "Top-down arena",
            prompt:
              "A top-down arena shooter: twin-stick controls, waves of chasing enemies, a score counter and a restart screen.",
          },
        ],
      },
      edit: {
        label: "Open existing",
        folder: "The Unity project folder (contains Assets, Packages and ProjectSettings)",
        placeholder: "Describe changes to this Unity project…",
        createLabel: "Open Unity project",
        starters: [
          {
            id: "unity-fix-compile",
            title: "Fix compile errors",
            prompt:
              "Compile the project, then fix every compiler error and warning you can without changing gameplay.",
          },
          {
            id: "unity-main-menu",
            title: "Add a main menu",
            prompt:
              "Add a main menu scene with Play, Settings (volume) and Quit, and wire it into the build settings.",
          },
          {
            id: "unity-tests",
            title: "Add PlayMode tests",
            prompt: "Add PlayMode tests for the player controller and run them.",
          },
        ],
      },
    },
  },
  godot: {
    id: "godot",
    name: "Godot",
    playbook: "LOCUS_GODOT_WORKFLOW",
    heading: "What should we build in Godot?",
    lead: "A Host coding agent creates or edits a real Godot 4 project, then imports, smoke-tests and exports it with your Godot editor.",
    requires: "Godot 4 installed",
    actions: {
      create: {
        label: "New project",
        folder: "A writable parent folder — the project is created in a new child folder",
        placeholder: "Describe the Godot game project to create…",
        createLabel: "Create Godot project",
        starters: [
          {
            id: "godot-platformer",
            title: "2D platformer",
            prompt:
              "A 2D platformer with a responsive CharacterBody2D (coyote time, jump buffering), a tile-based test level, coins and a goal flag.",
          },
          {
            id: "godot-fps-room",
            title: "First-person room",
            prompt:
              "A 3D first-person controller in a small lit room with interactable doors and a pause menu.",
          },
          {
            id: "godot-roguelite",
            title: "Top-down roguelite",
            prompt:
              "A top-down roguelite room: player movement and dash, melee attack, three enemy types and a door that opens when the room is cleared.",
          },
        ],
      },
      edit: {
        label: "Open existing",
        folder: "The Godot project folder (contains project.godot)",
        placeholder: "Describe changes to this Godot project…",
        createLabel: "Open Godot project",
        starters: [
          {
            id: "godot-fix-errors",
            title: "Fix import errors",
            prompt: "Run a headless import, then fix every script and scene error it reports.",
          },
          {
            id: "godot-web-export",
            title: "Add a Web export",
            prompt: "Add a Web export preset and export a playable build I can preview.",
          },
          {
            id: "godot-settings",
            title: "Add a settings menu",
            prompt:
              "Add a settings menu with volume, fullscreen and key rebinding, saved to user://.",
          },
        ],
      },
    },
  },
  unreal: {
    id: "unreal",
    name: "Unreal",
    playbook: "LOCUS_UNREAL_WORKFLOW",
    heading: "What should we build in Unreal?",
    lead: "A Host coding agent creates or edits a real Unreal Engine project, then compiles, tests and packages it with your installed engine.",
    requires: "Unreal Engine installed (Epic Games Launcher, source build or LOCUS_UNREAL_ENGINE)",
    actions: {
      create: {
        label: "New project",
        folder: "A writable parent folder — the project is created in a new child folder",
        placeholder: "Describe the Unreal project to create…",
        createLabel: "Create Unreal project",
        starters: [
          {
            id: "unreal-third-person",
            title: "Third-person starter",
            prompt:
              "A C++ third-person character with Enhanced Input (move, look, jump, sprint), a follow camera and a small greybox level.",
          },
          {
            id: "unreal-fps-arena",
            title: "FPS arena",
            prompt:
              "A first-person arena: hitscan weapon, health and ammo pickups, enemy waves that chase the player, and a score HUD.",
          },
          {
            id: "unreal-physics-puzzle",
            title: "Physics puzzle",
            prompt:
              "A physics puzzle room: grab and throw objects, pressure plates that open a door, and a goal trigger that ends the level.",
          },
        ],
      },
      edit: {
        label: "Open existing",
        folder: "The Unreal project folder (contains the .uproject)",
        placeholder: "Describe changes to this Unreal project…",
        createLabel: "Open Unreal project",
        starters: [
          {
            id: "unreal-fix-compile",
            title: "Fix compile errors",
            prompt:
              "Compile the C++ editor target and all Blueprints, then fix every error reported.",
          },
          {
            id: "unreal-tests",
            title: "Add automation tests",
            prompt:
              "Add C++ automation tests for the core gameplay classes and make them pass in a headless run.",
          },
          {
            id: "unreal-package",
            title: "Package a build",
            prompt:
              "Package a Development build for this machine's platform and report any cook errors.",
          },
        ],
      },
    },
  },
  blender: {
    id: "blender",
    name: "Blender",
    playbook: "LOCUS_BLENDER_WORKFLOW",
    heading: "What should we model in Blender?",
    lead: "A Host coding agent creates or edits real .blend files with your local Blender, then renders and exports them.",
    requires: "Blender installed (on PATH or LOCUS_BLENDER_PATH)",
    actions: {
      create: {
        label: "New .blend",
        folder: "A writable folder — new .blend files never overwrite existing ones",
        placeholder: "Describe the Blender asset to create…",
        createLabel: "Create .blend",
        starters: [
          {
            id: "blender-prop",
            title: "Low-poly prop",
            prompt:
              "A low-poly treasure chest with a separate lid, simple PBR materials and a GLB export for games.",
          },
          {
            id: "blender-kit",
            title: "Modular kit",
            prompt:
              "A modular dungeon kit on a 2 m grid: floor, wall, corner, doorway and pillar pieces, exported as GLB.",
          },
          {
            id: "blender-turntable",
            title: "Turntable render",
            prompt:
              "A stylised potted plant with a three-point light rig and a camera turntable render.",
          },
        ],
      },
      edit: {
        label: "Edit existing",
        folder: "The folder that holds your .blend files — they are edited in place",
        placeholder: "Describe changes to an existing Blender project…",
        createLabel: "Open Blender project",
        starters: [
          {
            id: "blender-cleanup",
            title: "Clean up for export",
            prompt:
              "Apply transforms, fix normals, remove unused data and export the main object as GLB.",
          },
          {
            id: "blender-lods",
            title: "Generate LODs",
            prompt: "Create two decimated LOD levels of the main mesh and export each as GLB.",
          },
          {
            id: "blender-render",
            title: "Render a preview",
            prompt: "Add a camera and lights if missing, then render a preview image of the scene.",
          },
        ],
      },
    },
  },
};

export function isNativeTarget(target: LaunchTarget): target is NativeEngine {
  return target !== "web";
}

/** Targets that make sense on a surface; anything else falls back to the web canvas. */
export function targetForSurface(surface: string, target: LaunchTarget): LaunchTarget {
  if (surface !== "game" && surface !== "assets") return "web";
  return LAUNCH_TARGETS[surface].some((row) => row.id === target) ? target : "web";
}

export function nativeProjectPrompt(
  engine: NativeEngine,
  input: { action: ProjectAction; request: string; projectPath?: string },
): string {
  if (engine === "unity") return unityProjectPrompt(input);
  if (engine === "godot") return godotProjectPrompt(input);
  if (engine === "unreal") return unrealProjectPrompt(input);
  return blenderProjectPrompt(input);
}

export type NativeReadiness = {
  /** Shown when the launch can't start; null when it can. */
  blocker: string | null;
  checks: { id: "host" | "folder"; label: string; ok: boolean }[];
};

/**
 * Native engines run a Host coding agent on this machine against a real folder.
 * Report what is missing so the Send button never disables silently.
 */
export function nativeReadiness(input: {
  engine: NativeEngine;
  action: ProjectAction;
  runtime: AgentRuntime;
  remote: boolean;
  hostAllowed: boolean;
  hostDir?: string;
}): NativeReadiness {
  const info = NATIVE_ENGINES[input.engine];
  const onHost = input.hostAllowed && input.runtime === "host" && !input.remote;
  const folder = Boolean(input.hostDir?.trim());
  const checks: NativeReadiness["checks"] = [
    { id: "host", label: "Runs on this machine (Host)", ok: onHost },
    { id: "folder", label: info.actions[input.action].folder, ok: folder },
  ];
  let blocker: string | null = null;
  if (!input.hostAllowed)
    blocker = `Your organization's policy blocks Host agents, which ${info.name} needs.`;
  else if (input.remote) blocker = `${info.name} runs on this machine. Switch placement to Local.`;
  else if (input.runtime !== "host") blocker = `${info.name} needs the Host runtime.`;
  else if (!folder)
    blocker =
      input.action === "edit"
        ? `Choose the ${info.name} project folder under Workspace.`
        : "Choose a folder under Workspace with Open folder.";
  return { blocker, checks };
}
