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
    files: _("Files")
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

        this._remaining_steps = ["software", "files"];
        this._results = {};
    },

    _search_step: function(step)
    {
        try
        {
            var argv = ["tracker-search", "--disable-snippets", "-l", "10", "--disable-color"];
            switch (step)
            {
                case "software": argv.push("--software"); break;
                case "files": argv.push("-f"); break;
            }
            var words = this._searchString.split(" ");
            for (var i in words)
            {
                if (words[i])
                {
                    argv.push(words[i]);
                }
            }
            let [res, pid, in_fd, out_fd, err_fd] = GLib.spawn_async_with_pipes(null, argv, null, GLib.SpawnFlags.SEARCH_PATH, null);
            out_reader = new Gio.DataInputStream(
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
                                    search_results.push(this_result);
                                }
                            }
                            catch(e)
                            {
                                global.log(e);
                            }
                        }
                        return true;
                    }else{
                        this._push_results(step, search_results);
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

    _push_results: function(step, results)
    {
        if (this._running)
        {
            this._results[step] = results;
            this._next_search_step();
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
            else
            {
                this._applet.push_results(this._results);
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

function FileResult(applet, filename)
{
    this._init(applet, filename);
}

FileResult.prototype = 
{
    __proto__: PopupMenu.PopupBaseMenuItem.prototype,
    
    _init: function(applet, filename)
    {
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this);
        
        this._filename = filename;
        this._applet = applet;
        
        this.icon = new St.Icon(
        {
            icon_name: "gtk-file",
            icon_size: 16,
            icon_type: St.IconType.FULLCOLOR
        });
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
                                     
            this.set_applet_icon_name("find");
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
            
            this._resultsSection = new PopupMenu.PopupMenuSection();
            this._search_menu.addMenuItem(this._resultsSection);

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

    push_results: function(results)
    {
        var children = this._resultsSection.actor.get_children();
        for (var i in children)
        {
            children[i].destroy();
        }
        
        var final_results = {};
        for (var result_type in results)
        {
            final_results[result_type] = new Array();
            if (results[result_type].length > 0)
            {
                for (var i in results[result_type])
                {
                    switch (result_type)
                    {
                        case "software":
                            let app = this._appSys.lookup_app(results[result_type][i]);
                            if (app)
                            {
                                let appinfo = app.get_app_info();
                                if (!appinfo || !appinfo.get_nodisplay())
                                {
                                    final_results[result_type].push(new ApplicationResult(this, app));
                                }
                            }
                            break;
                        case "files":
                            final_results[result_type].push(new FileResult(this, results[result_type][i]));
                            break;
                    }
                }
            }
        }
        var first_result_type = true;
        for (var result_type in final_results)
        {
            if (final_results[result_type].length > 0)
            {
                if (first_result_type)
                {
                    first_result_type = false;
                }
                else
                {
                    var separator = new PopupMenu.PopupSeparatorMenuItem();
                    this._resultsSection.actor.add_actor(separator.actor);
                }
                var result_type_label = new PopupMenu.PopupMenuItem(RESULT_TYPES_LABELS[result_type], 
                {
                    reactive: false,
                    hover: false,
                    sensitive: false,
                    focusOnHover: true
                });
                result_type_label.actor.set_style("font-weight: bold;");
                this._resultsSection.actor.add_actor(result_type_label.actor);
                
                for (var i in final_results[result_type])
                {
                    this._resultsSection.actor.add_actor(final_results[result_type][i].actor);
                }
            }
        }
    }
}

function main(metadata, orientation, panel_height, instanceId)
{
    let myApplet = new MyApplet(orientation, panel_height, instanceId);
    return myApplet;
}
