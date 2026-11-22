/** Executed only by the local Blender binary with --factory-startup --disable-autoexec. */
export const BLENDER_BRIDGE_SCRIPT = String.raw`import bpy
import json
import os
import runpy
import sys
import traceback

args = sys.argv[sys.argv.index("--") + 1:]
with open(args[0], "r", encoding="utf-8") as fh:
    req = json.load(fh)
out = req["output"]
file = req["file"]
action = req["action"]
report = {}

try:
    if action == "create":
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.mesh.primitive_cube_add()
        from mathutils import Vector
        bpy.ops.object.camera_add(location=(6.0, -6.0, 4.5))
        camera = bpy.context.object
        direction = Vector((0.0, 0.0, 0.0)) - camera.location
        camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        bpy.context.scene.camera = camera
        bpy.ops.object.light_add(type="AREA", location=(3.0, -4.0, 6.0))
        bpy.context.object.data.energy = 800
        bpy.context.object.data.shape = "DISK"
        bpy.context.object.data.size = 5
        bpy.ops.wm.save_as_mainfile(filepath=file)
        report["file"] = file
    elif action == "inspect" or action == "validate":
        scene = bpy.context.scene
        objects = []
        for obj in bpy.data.objects:
            entry = {"name": obj.name, "type": obj.type, "location": list(obj.location)}
            if obj.type == "MESH":
                entry["vertices"] = len(obj.data.vertices)
                entry["polygons"] = len(obj.data.polygons)
            objects.append(entry)
        report = {
            "file": bpy.data.filepath,
            "scenes": [s.name for s in bpy.data.scenes],
            "activeScene": scene.name,
            "objects": objects[:2000],
            "objectCount": len(bpy.data.objects),
            "missingImages": [img.filepath for img in bpy.data.images
                              if img.source == "FILE" and not img.packed_file
                              and not os.path.exists(bpy.path.abspath(img.filepath))],
        }
        if action == "validate" and report["missingImages"]:
            raise RuntimeError("Missing external images: " + ", ".join(report["missingImages"][:10]))
    elif action == "render":
        scene = bpy.context.scene
        scene.render.filepath = os.path.join(out, "preview.png")
        scene.render.image_settings.file_format = "PNG"
        scene.render.resolution_percentage = min(scene.render.resolution_percentage, 100)
        scene.render.resolution_x = min(scene.render.resolution_x, 1600)
        scene.render.resolution_y = min(scene.render.resolution_y, 1600)
        bpy.ops.render.render(write_still=True)
        report = {"image": "preview.png", "scene": scene.name}
    elif action == "export":
        path = os.path.join(out, "asset." + req["format"])
        fmt = req["format"]
        if fmt == "glb":
            bpy.ops.export_scene.gltf(filepath=path, export_format="GLB")
        elif fmt == "fbx":
            bpy.ops.export_scene.fbx(filepath=path)
        elif fmt == "obj":
            bpy.ops.wm.obj_export(filepath=path)
        elif fmt == "stl":
            bpy.ops.wm.stl_export(filepath=path)
        else:
            raise RuntimeError("Unsupported export format")
        report = {"export": os.path.basename(path), "bytes": os.stat(path).st_size}
    elif action == "script":
        # Explicitly requested project script: runs with the user's permissions.
        # This is never derived from an arbitrary tool expression or command string.
        runpy.run_path(req["script"], run_name="__main__")
        # Persist successful scripted scene changes to the selected .blend file.
        bpy.ops.wm.save_as_mainfile(filepath=file)
        report = {"script": req["script"], "file": bpy.data.filepath}
    else:
        raise RuntimeError("Unsupported Blender action")
except Exception as exc:
    report = {"error": str(exc), "trace": traceback.format_exc()[-6000:]}
    print(report["trace"], file=sys.stderr)
    with open(os.path.join(out, "report.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh)
    sys.exit(1)
with open(os.path.join(out, "report.json"), "w", encoding="utf-8") as fh:
    json.dump(report, fh)
`;
