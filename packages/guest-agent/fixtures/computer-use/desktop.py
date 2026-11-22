"""Interactive AT-SPI fixture: save text through a real GTK file chooser."""
import pathlib
import sys
import gi

gi.require_version("Gtk", "3.0")
from gi.repository import Gtk

window = Gtk.Window(title="Locus computer-use fixture")
window.connect("destroy", Gtk.main_quit)
box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
entry = Gtk.Entry()
entry.get_accessible().set_name("Document text")
button = Gtk.Button(label="Save document")


def save(_button):
    dialog = Gtk.FileChooserDialog(
        title="Save fixture", parent=window, action=Gtk.FileChooserAction.SAVE
    )
    dialog.add_buttons("Cancel", Gtk.ResponseType.CANCEL, "Save", Gtk.ResponseType.OK)
    dialog.set_current_folder(sys.argv[1])
    dialog.set_current_name("result.txt")
    if dialog.run() == Gtk.ResponseType.OK:
        pathlib.Path(dialog.get_filename()).write_text(entry.get_text())
    dialog.destroy()


button.connect("clicked", save)
box.pack_start(entry, True, True, 0)
box.pack_start(button, True, True, 0)
window.add(box)
window.show_all()
Gtk.main()
