const Lang = imports.lang;
const Applet = imports.ui.applet;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Gio = imports.gi.Gio;
const Util = imports.misc.util;
const Gettext = imports.gettext.domain('cinnamon-applets');
const PopupMenu = imports.ui.popupMenu;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const Cinnamon = imports.gi.Cinnamon;
const Main = imports.ui.main;
const Settings = imports.ui.settings;
const _ = Gettext.gettext;

const RESULT_TYPES_LABELS = 
{
    software: _("Software"),
    pictures: _("Pictures"),
    videos: _("Videos"),
    music: _("Music"),
    folders: _("Folders"),
    files: _("Other Files")
}

function SearchProcess(applet, searchString)
{
    this._init(applet, searchString);
}

SearchProcess.prototype =
{
    _init: function(applet, searchString)
    {
        this._running = false;
        this._applet = applet;
        this._searchString = searchString;

        this._remaining_steps = ["software", "pictures", "videos", "music", "folders", "files"];
        this._full_results = new Array();
    },

    _search_step: function(step)
    {
        try
        {
            var argv = ["tracker-search", "--disable-snippets", "-l", (step == "folders" ? "5" : "10"), "--disable-color"];
            switch (step)
            {
                case "software": argv.push("--software"); break;
                case "folders": argv.push("-s"); break;
                case "files": argv.push("-f"); break;
                case "pictures": argv.push("-i"); break;
                case "videos": argv.push("-v"); break;
                case "music": argv.push("-m"); break;
            }
            var words = this._searchString.split(" ");
            for (var i in words)
            {
                if (words[i])
                {
                    if (words[i][0] == '"' && words[i][words[i].length - 1] == '"')
                    {
                        argv.push(words[i].substring(1, words[i].length - 1));
                    }
                    else
                    {
                        argv.push("*" + words[i] + "*");
                    }
                }
            }
            let [res, pid, in_fd, out_fd, err_fd] = GLib.spawn_async_with_pipes(null, argv, null, GLib.SpawnFlags.SEARCH_PATH, null);
            var out_reader = new Gio.DataInputStream(
            {
                base_stream: new Gio.UnixInputStream(
                {
                    fd: out_fd
                })
            });

            let search_results = new Array();

            Mainloop.timeout_add(100, Lang.bind(this, function(stream, pid)
            {
                try
                {
                    let [output, size] = stream.read_line(null);
                    if (size > 0){
                        let current_results = output.toString().split("\n");
                        var this_result;
                        var results_parts;
                        for (var i in current_results)
                        {
                            try
                            {
                                this_result = current_results[i].trim().trim();
                                if (this_result != "" && this_result.substring(0, 8) == "file:///")
                                {
                                    switch (step)
                                    {
                                        case "software":
                                            results_parts = this_result.split("/");
                                            this_result = results_parts[results_parts.length - 1].split(".desktop")[0] + ".desktop";
                                            break;
                                    }
                                    if (this._full_results.indexOf(this_result) == -1)
                                    {
                                        search_results.push(this_result);
                                        this._full_results.push(this_result);
                                    }
                                }
                            }
                            catch(e)
                            {
                                global.log(e);
                            }
                        }
                        return true;
                    }else{
                        if (this._running)
                        {
                            this._applet.push_results(step, search_results);
                            this._next_search_step();
                        }
                        return false;
                    }
                }
                catch(e)
                {
                    global.log(e);
                }
            }, out_reader, pid));
        }
        catch(e)
        {
            global.log(e);
        }
    },

    _next_search_step: function()
    {
        if (this._running)
        {
            if (this._remaining_steps.length > 0)
            {
                var step = this._remaining_steps.shift();
                this._search_step(step);
            }
        }
    },

    run: function()
    {
        this._running = true;

        this._next_search_step();
    },

    stop: function()
    {
        this._running = false;
    }
}

function ApplicationResult(applet, app)
{
    this._init(applet, app);
}

ApplicationResult.prototype = 
{
    __proto__: PopupMenu.PopupBaseMenuItem.prototype,
    
    _init: function(applet, app)
    {
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this);
        
        this._app = app;
        this._applet = applet;
        
        this.icon = this._app.create_icon_texture(16);
        this.addActor(this.icon);
        this.name = this._app.get_name();
        this.label = new St.Label(
        {
            text: this.name
        });
        this.label.set_style("width: 180px;");
        this.addActor(this.label);
        this.icon.realize();
        this.label.realize();
        
        this.connect('activate', Lang.bind(this, this._on_activate));
    },
    
    _on_activate: function()
    {
        this._applet._search_menu.close();
        this._app.open_new_window(-1);
    }
}

function FileResult(applet, filename, type)
{
    this._init(applet, filename, type);
}

FileResult.prototype = 
{
    __proto__: PopupMenu.PopupBaseMenuItem.prototype,
    
    _init: function(applet, filename, type)
    {
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this);
        
        this._filename = filename;
        this._applet = applet;
        
        try
        {
            let icon = Cinnamon.util_get_icon_for_uri(filename);
            if (icon)
            {
                this.icon = St.TextureCache.get_default().load_gicon(null, icon, 16);
            }
        }
        catch (e)
        {
        }
        if (!this.icon)
        {
            this.icon = new St.Icon(
            {
                icon_name: (type == "files" ? "gtk-file" : "folder"),
                icon_size: 16,
                icon_type: St.IconType.FULLCOLOR
            });
        }
        this.addActor(this.icon);
        this.label = new St.Label(
        {
            text: filename
        });
        this.addActor(this.label);
        this.icon.realize();
        this.label.realize();
        
        this.connect('activate', Lang.bind(this, this._on_activate));
    },
    
    _on_activate: function()
    {
        this._applet._search_menu.close();
        Util.trySpawn(["xdg-open", this._filename]);
    }
}

function MyApplet(orientation, panel_height, instanceId)
{
    this._init(orientation, panel_height, instanceId);
}

MyApplet.prototype =
{
    __proto__: Applet.IconApplet.prototype,

    _init: function(orientation, panel_height, instanceId)
    {
        try
        {
            Applet.IconApplet.prototype._init.call(this, orientation, panel_height, instanceId);
        
            menuItem = new Applet.MenuItem(_("Indexing Preferences"), null, Lang.bind(this, function(actor, event)
            {
                Util.spawnCommandLine('tracker-preferences');
            }));
            this._applet_context_menu.addMenuItem(menuItem);
            
            this.settings = new Settings.AppletSettings(this, "tracker@glebihan", instanceId);
            this.settings.bindProperty(Settings.BindingDirection.IN,
                                     "launch_shortcut",
                                     "launch_shortcut",
                                     this.on_launch_shortcut_changed,
                                     null);
                                     
            this.set_applet_icon_name("edit-find-symbolic");
            this.set_applet_tooltip(_("Search files using Tracker"));

            let menuManager = new PopupMenu.PopupMenuManager(this);
            this._search_menu = new Applet.AppletPopupMenu(this, orientation);
            menuManager.addMenu(this._search_menu);

            let section = new PopupMenu.PopupMenuSection();
            this._search_menu.addMenuItem(section);

            this.searchEntry = new St.Entry(
            {
                name: 'menu-search-entry',
                hint_text: _("Type to search..."),
                track_hover: true,
                can_focus: true
            });
            section.actor.set_style("padding: 10px;");
            this._searchInactiveIcon = new St.Icon(
            {
                style_class: 'menu-search-entry-icon',
                icon_name: 'edit-find',
                icon_type: St.IconType.SYMBOLIC
            });
            this.searchEntry.set_secondary_icon(this._searchInactiveIcon);

            section.actor.add_actor(this.searchEntry);
            
            this._scrollBox = new St.ScrollView(
            {
                x_fill: true,
                y_fill: false,
                y_align: St.Align.START
            });
            this._search_menu.addActor(this._scrollBox);
            this._container = new St.BoxLayout(
            {
                vertical:true
            });
            this._scrollBox.add_actor(this._container);
            this._scrollBox.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);
            this._scrollBox.set_auto_scrolling(true);

            this.searchEntryText = this.searchEntry.clutter_text;
            this.searchEntryText.connect('text-changed', Lang.bind(this, this._onSearchTextChanged));
            
            this._search_process = null;
            
            this._appSys = Cinnamon.AppSystem.get_default();
            
            this.on_launch_shortcut_changed();
        }
        catch(e)
        {
            global.logError(e);
        }
    },
    
    on_launch_shortcut_changed: function()
    {
        Main.keybindingManager.addHotKey("tracker_glebihan_launch", this.launch_shortcut, Lang.bind(this, this.launch));
    },

    _onSearchTextChanged: function(se, prop)
    {
        if (this._search_process != null)
        {
            this._search_process.stop();
        }

        let searchString = this.searchEntry.get_text();

        if (searchString != "")
        {
            this._search_process = new SearchProcess(this, searchString);
            this._search_process.run();
        }
    },

    on_applet_clicked: function(event)
    {
        if (event.get_button() == 1)
        {
            this.launch();
        }
    },
    
    launch: function()
    {
        this._search_menu.toggle();
        global.stage.set_key_focus(this.searchEntry);
        this.searchEntryText.set_selection(0, this.searchEntry.get_text().length);
    },

    push_results: function(result_type, results)
    {
        if (result_type == "software")
        {
            var children = this._container.get_children();
            for (var i in children)
            {
                children[i].destroy();
            }
        }
        
        var final_results = new Array();
        let button;
        if (results.length > 0)
        {
            for (var i in results)
            {
                switch (result_type)
                {
                    case "software":
                        let app = this._appSys.lookup_app(results[i]);
                        if (app)
                        {
                            let appinfo = app.get_app_info();
                            if (!appinfo || !appinfo.get_nodisplay())
                            {
                                button = new ApplicationResult(this, app);
                                button.actor.connect("notify::hover", Lang.bind(this, this._scrollToButton));
                                button.actor.connect("key-focus-in", Lang.bind(this, this._scrollToButton));
                                final_results.push(button);
                            }
                        }
                        break;
                    case "pictures":
                    case "videos":
                    case "music":
                    case "folders":
                    case "files":
                        button = new FileResult(this, results[i], result_type);
                        button.actor.connect("notify::hover", Lang.bind(this, this._scrollToButton));
                        button.actor.connect("key-focus-in", Lang.bind(this, this._scrollToButton));
                        final_results.push(button);
                        break;
                }
            }
        }
        
        var first_result_type = true;
        if (final_results.length > 0)
        {
            if (this._container.get_children().length > 0)
            {
                var separator = new PopupMenu.PopupSeparatorMenuItem();
                this._container.add_actor(separator.actor);
            }
            var result_type_label = new PopupMenu.PopupMenuItem(RESULT_TYPES_LABELS[result_type], 
            {
                reactive: false,
                hover: false,
                sensitive: false,
                focusOnHover: true
            });
            result_type_label.actor.set_style("font-weight: bold;");
            this._container.add_actor(result_type_label.actor);
            
            for (var i in final_results)
            {
                this._container.add_actor(final_results[i].actor);
            }
        }
    },
    
    _scrollToButton: function(button)
    {
        var current_scroll_value = this._scrollBox.get_vscroll_bar().get_adjustment().get_value();
        var box_height = this._scrollBox.get_allocation_box().y2 - this._scrollBox.get_allocation_box().y1;
        var new_scroll_value = current_scroll_value;
        if (current_scroll_value > button.get_allocation_box().y1 - 10) new_scroll_value = button.get_allocation_box().y1 - 10;
        if (box_height + current_scroll_value < button.get_allocation_box().y2 + 10) new_scroll_value = button.get_allocation_box().y2-box_height + 10;
        if (new_scroll_value != current_scroll_value) this._scrollBox.get_vscroll_bar().get_adjustment().set_value(new_scroll_value);
    }
}

function main(metadata, orientation, panel_height, instanceId)
{
    let myApplet = new MyApplet(orientation, panel_height, instanceId);
    return myApplet;
}
