// TCG Life — WebView2 window host.
//
// A tiny .NET Framework 4 WinForms exe (compiles with the stock csc.exe; no
// SDK or NuGet restore needed) that turns the browser-tab experience into a
// real desktop app:
//
//   • single instance per machine (named mutex — second launch just pings)
//   • spawns release/TCG-Life-Server.exe (the SEA) as its child, headless
//   • waits for the port the server announces, then hosts it in WebView2
//   • system tray icon (Open / Quit) as a convenience: the window itself is
//     a normal taskbar citizen — minimize minimizes, X quits (stopping the
//     server) — but if you Quit a second launch of the exe pings a restore
//     event, and the tray menu can re-show the window
//   • the child server self-terminates via TCGLIFE_PARENT_PID when the
//     host dies
//
// Build: scripts/build-host.sh
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.IO.Compression;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace TcgLifeHost
{
    internal static class Program
    {
        // DPI awareness comes from the embedded app manifest (see
        // scripts/build-host.sh -win32manifest) — a P/Invoke here turned out
        // to be unreliable on some Windows installs (missing entry point).
        private static StreamWriter s_serverLog;

        // Splash state (see SplashForm below). The splash lives on its own
        // STA thread — see ShowSplash for why.
        private static SplashForm s_splashForm;
        private static Thread s_splashThread;
        private static EventWaitHandle s_splashReady; // set once the splash is shown
        private static int s_splashShownAt;
        private static bool s_splashClosed;
        private static volatile bool s_bootingPort; // true only while we wait for the server's port:
                                                    // boot lines stream onto the splash stage then
        private static readonly ManualResetEventSlim s_portReady = new ManualResetEventSlim(false);
        private static int s_port;                   // port the server announces (it binds port 0)

        // --- Startup budget ---------------------------------------------------
        // How long the port may stay silent before the splash complains.
        // The old 30s was measured too tight: on a cold boot (machine just
        // started, a save that has grown past 600MB, first launch of the day)
        // the packaged server needs longer than that to open SQLite and
        // register its routes. We gave up mid-boot, declared "didn't start"
        // and then KILLED the server — so the player saw a failure panel for
        // a game that was seconds away from running. The server's own log
        // lines stream onto the stage meanwhile, and a timeout can still
        // recover while the panel is up (see the grace window below).
        private const int STARTUP_BUDGET_MS = 120000; // 2 min of quiet before we say anything
        private const int STARTUP_GRACE_MS = 120000;  // +2 min more behind the failure panel

        // Tray state. The window is a normal taskbar citizen (closing quits,
        // minimizing minimizes) — the tray icon is a convenience for finding
        // the game again, not a place it hides in.
        private static NotifyIcon s_tray;
        private static bool s_forceExit;     // set before ANY programmatic close:
                                             // tray Quit, dead-server watchdog, init
                                             // failure — they must really exit, not hide

        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            var exeDir = AppDomain.CurrentDomain.BaseDirectory;
            var serverExe = Path.Combine(exeDir, "TCG-Life-Server.exe");
            // (A missing server exe is handled inside RunGame, on the splash.)

            // Single instance: a second double-click should never spawn a second
            // server/window — tell the user where the game already is.
            bool createdNew;
            using (var mutex = new Mutex(true, @"Local\TCG-Life-Game-Window", out createdNew))
            {
                if (!createdNew)
                {
                    // Already running — quite possibly minimized to the tray,
                    // where there is no taskbar button to click. Ping it to
                    // come back instead of just saying where it is.
                    try
                    {
                        using (var ev = EventWaitHandle.OpenExisting(@"Local\TCG-Life-TrayRestore"))
                            ev.Set();
                        return;
                    }
                    catch { }
                    MessageBox.Show("TCG Life is already running — check your taskbar.",
                        "TCG Life", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                RunGame(exeDir, serverExe);
                GC.KeepAlive(mutex); // hold the mutex until the game exits
            }
        }

        private static void RunGame(string exeDir, string serverExe)
        {
            // --- 1. Open the log, show the splash immediately, then spawn the
            // packaged server. (Log first so splash diagnostics land in it.)
            var logPath = Path.Combine(exeDir, "TCG-Life-Server.log");
            try { if (File.Exists(logPath) && new FileInfo(logPath).Length > 2 * 1024 * 1024) File.Delete(logPath); } catch { }
            s_serverLog = new StreamWriter(logPath, false, Encoding.UTF8) { AutoFlush = true };
            s_serverLog.WriteLine("[host] " + DateTime.Now + " — launching server");
            ShowSplash();

            if (!File.Exists(serverExe))
            {
                FailSplash("Couldn't find the game server",
                    "TCG-Life-Server.exe is missing next to the app. Keep the release folder " +
                    "together — the game and its server travel as a set.",
                    logPath);
                WaitForSplashExit();
                return;
            }

            // The server binds port 0: the OS picks a port that is free at the
            // moment of the bind and announces it on stdout. We do not probe
            // 8787 ourselves any more — a probe can pass just before a dev
            // server takes the port, and Windows can even report a bound
            // wildcard port as available. There is no chosen port to collide
            // with, and the window only loads the port the server announces.
            s_port = 0;
            s_portReady.Reset();

            var server = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = serverExe,
                    WorkingDirectory = exeDir,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                }
            };
            server.StartInfo.EnvironmentVariables["TCGLIFE_PORT"] = "0";
            server.StartInfo.EnvironmentVariables["TCGLIFE_NO_OPEN"] = "1"; // the window IS the UI
            server.StartInfo.EnvironmentVariables["TCGLIFE_PARENT_PID"] = Process.GetCurrentProcess().Id.ToString();
            try { server.Start(); } catch (Exception ex)
            {
                FailSplash("Couldn't start the server",
                    "The game server process failed to launch. Details are in TCG-Life-Server.log next to the app.",
                    logPath);
                WaitForSplashExit();
                TryKill(server);
                return;
            }
            SetStage("Starting game server…");
            server.OutputDataReceived += (_, e) =>
            {
                LogLine("[server] " + e.Data);
                ReportBoot(e.Data);
                int announced = ParseGamePort(e.Data);
                if (announced > 0)
                {
                    s_port = announced;
                    s_portReady.Set();
                }
            };
            server.ErrorDataReceived += (_, e) => { LogLine("[server] " + e.Data); ReportBoot(e.Data); };
            server.BeginOutputReadLine();
            server.BeginErrorReadLine();

            // --- 2. Wait for the game to answer before showing the window.
            s_bootingPort = true;
            if (!WaitGame(STARTUP_BUDGET_MS, server))
            {
                if (server.HasExited)
                    LogLine("[host] server exited during startup (code " + server.ExitCode + ")");
                FailSplash(server.HasExited ? "The game server exited" : "The game server is taking a while",
                    server.HasExited
                        ? "It never answered on its port. If another TCG Life is already running, close that one first — " +
                          "otherwise see TCG-Life-Server.log next to the app for the cause."
                        : "Big saves can take a minute or two to open on a cold start. Keep this window open — " +
                          "we keep waiting, and the game opens the moment the server answers.",
                    logPath);

                // Grace window: the server may just be slow, not broken. If it
                // answers while the panel is up, take the panel down and carry
                // on — a slow boot must never look like a dead game.
                if (!server.HasExited && WaitGame(STARTUP_GRACE_MS, server))
                {
                    LogLine("[host] server answered during the grace window — recovering the splash");
                    RecoverSplash();
                }
                else
                {
                    if (!server.HasExited)
                        UpdateFailSplash("The game server didn't start",
                            "It never answered on its port. If another TCG Life is already running, close that one first — " +
                            "otherwise see TCG-Life-Server.log next to the app for the cause.");
                    s_bootingPort = false;
                    WaitForSplashExit();
                    TryKill(server);
                    return;
                }
            }
            s_bootingPort = false;
            SetStage("Preparing catalog…");

            // --- 3. The window (geometry restored from the last session).
            var layout = LoadWindowLayout();
            var form = new Form
            {
                Text = "TCG Life",
                MinimumSize = new System.Drawing.Size(1024, 700),
                BackColor = System.Drawing.Color.FromArgb(13, 17, 32),
                ShowInTaskbar = true, // a real taskbar button — the game lives where players expect it
            };
            if (layout.UseDefault)
            {
                form.StartPosition = FormStartPosition.CenterScreen;
                form.Size = new System.Drawing.Size(1440, 940);
            }
            else
            {
                form.StartPosition = FormStartPosition.Manual;
                form.DesktopBounds = layout.Bounds;
            }
            try { form.Icon = System.Drawing.Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            if (layout.Maximized) form.WindowState = FormWindowState.Maximized;

            // --- System tray: a convenience, not a hiding place. The window
            // keeps its taskbar button; minimize minimizes, X quits for real
            // (stopping the server). The tray menu "Open TCG Life" re-shows the
            // window if it's minimized or behind other windows, and a second
            // launch of the exe pings the same restore.
            s_tray = new NotifyIcon { Text = "TCG Life", Visible = true };
            try { s_tray.Icon = form.Icon; }
            catch { }
            var trayMenu = new ContextMenuStrip();
            trayMenu.Items.Add("Open TCG Life", null, delegate { RestoreFromTray(form); });
            trayMenu.Items.Add(new ToolStripSeparator());
            trayMenu.Items.Add("Quit", null, delegate { s_forceExit = true; form.Close(); });
            s_tray.ContextMenuStrip = trayMenu;
            s_tray.DoubleClick += delegate { RestoreFromTray(form); };

            form.FormClosing += (sSender, eArgs) =>
            {
                LogLine("[host] form closing: reason=" + eArgs.CloseReason + " forceExit=" + s_forceExit);
                SaveWindowLayout(form);
                // No close interception: X quits the game for real (and the
                // FormClosed handler stops the server). The tray icon and the
                // single-instance ping remain as conveniences.
            };

            // A second launch of the exe pings this event to un-tray us.
            EventWaitHandle restoreSignal = null;
            System.Threading.Timer restoreWatcher = null;
            try
            {
                restoreSignal = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\TCG-Life-TrayRestore");
                restoreWatcher = new System.Threading.Timer(_ =>
                {
                    if (restoreSignal.WaitOne(0)) TryInvoke(form, delegate { RestoreFromTray(form); });
                }, null, 500, 400);
            }
            catch { }

            var web = new WebView2
            {
                Dock = DockStyle.Fill,
                DefaultBackgroundColor = System.Drawing.Color.FromArgb(13, 17, 32),
            };
            // Profile data lives in the user's AppData so the release folder stays clean
            // and movable — nothing is written back into it.
            web.CreationProperties = new CoreWebView2CreationProperties
            {
                UserDataFolder = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "TCGLife", "WebView2"),
            };
            web.CoreWebView2InitializationCompleted += (_, e) =>
            {
                if (!e.IsSuccess)
                {
                    FailSplash("Couldn't start the embedded browser",
                        "The WebView2 runtime failed to initialize (" + e.InitializationException.Message + ").\n" +
                        "Install the Evergreen WebView2 Runtime from Microsoft and relaunch.",
                        null);
                    return;
                }
                var s = web.CoreWebView2.Settings;
                s.AreDefaultContextMenusEnabled = false; // game, not a document
                s.IsZoomControlEnabled = false;
                s.IsStatusBarEnabled = false;
                // Show the main window only when the game is actually on
                // screen — NavigationCompleted fires after the SPA's first
                // frame. Until then the splash covers the boot; a minimum
                // display time stops a fast boot from blinking.
                web.CoreWebView2.NavigationCompleted += (s2, e2) => HideSplash();
            };

            SetStage("Opening the shop…");

            form.Controls.Add(web);
            web.Source = new Uri("http://127.0.0.1:" + s_port + "/"); // triggers async creation

            // Small conveniences: F5 reload, F11 fullscreen.
            form.KeyPreview = true;
            form.KeyDown += (_, e) =>
            {
                if (e.KeyCode == Keys.F5 && web.CoreWebView2 != null) web.CoreWebView2.Reload();
                if (e.KeyCode == Keys.F11)
                {
                    if (form.FormBorderStyle == FormBorderStyle.None)
                    {
                        form.FormBorderStyle = FormBorderStyle.Sizable;
                        form.WindowState = FormWindowState.Normal;
                    }
                    else
                    {
                        form.FormBorderStyle = FormBorderStyle.None;
                        form.WindowState = FormWindowState.Maximized;
                    }
                }
            };

            // Dead-server guard. Created only here — after boot succeeded —
            // so it can never interfere with the boot failure panel: a failed
            // boot never reaches this line at all.
            var watchdog = new System.Threading.Timer(_ =>
            {
                if (server.HasExited)
                    TryInvoke(form, delegate { s_forceExit = true; form.Close(); });
            }, null, 4000, 3000);

            form.FormClosed += (_, eClosed) =>
            {
                watchdog.Dispose();
                if (restoreWatcher != null) restoreWatcher.Dispose();
                if (restoreSignal != null) restoreSignal.Dispose();
                HideSplash();
                LogLine("[host] window closed — stopping server");
                if (s_tray != null) { s_tray.Visible = false; s_tray.Dispose(); s_tray = null; }
                TryKill(server);
            };

            Application.Run(form);
            TryKill(server); // belt and braces
        }

        // ---------------------------------------------------------------
        // Splash screen — branded cover for the two dead periods of a
        // double-click launch: the server boot (seconds) and WebView2's
        // first render. Closes the moment the game's first frame lands.
        //
        // The splash runs on its OWN STA thread with a private message
        // pump: the main thread floods its queue while initializing the
        // webview, which starved the same-thread animation to ~13fps
        // (measured, twice). A separate pump paints every frame.
        // ---------------------------------------------------------------
        private static void ShowSplash()
        {
            if (s_splashThread != null) return;
            s_splashShownAt = Environment.TickCount;
            s_splashReady = new EventWaitHandle(false, EventResetMode.AutoReset);
            var thread = new Thread(() =>
            {
                try
                {
                    var splash = new SplashForm();
                    s_splashForm = splash;
                    splash.Show();
                    s_splashReady.Set(); // handle live — cross-thread calls safe now
                    LogLine("[host] splash shown " + splash.Width + "x" + splash.Height +
                        " at " + splash.Left + "," + splash.Top);
                    Application.Run(splash); // the splash's private message pump
                }
                catch { }
            });
            thread.SetApartmentState(ApartmentState.STA);
            thread.IsBackground = true; // never blocks process exit
            s_splashThread = thread;
            thread.Start();
        }

        private static void HideSplash()
        {
            if (s_splashClosed) return;
            s_splashClosed = true;
            var elapsed = Environment.TickCount - s_splashShownAt;
            // No blink: hold the minimum display time. The splash pumps
            // itself on its own thread, so waiting here costs no frames.
            while (Environment.TickCount - s_splashShownAt < 900)
                Thread.Sleep(20);
            var frames = 0;
            var splash = s_splashForm;
            if (splash != null && splash.m_Icon != null) frames = splash.m_Icon.FramesPainted;
            try
            {
                if (splash != null && splash.IsHandleCreated)
                    splash.BeginInvoke((Action)(() => splash.Close()));
            }
            catch { }
            if (s_splashThread != null) s_splashThread.Join(2000);
            s_splashThread = null;
            s_splashForm = null;
            s_splashReady = null;
            LogLine("[host] splash closed after " + elapsed + "ms (" + frames + " anim frames)");
        }

        // --- Splash stage/failure helpers (safe to call from the main
        // thread: the splash lives on its own thread, so these marshal).
        private static void SetStage(string text)
        {
            var splash = s_splashForm;
            if (splash == null || s_splashClosed) return;
            SafeSplashAction(splash, delegate { splash.SetStage(text); });
        }

        // Show the branded failure panel and keep the splash up until the
        // user closes it. Never throws, whatever state the splash is in —
        // including the race where the splash thread is still constructing
        // (PNG decode): wait for the ready signal before touching it.
        private static void FailSplash(string heading, string detail, string logPath)
        {
            var ready = s_splashReady;
            var shown = false;
            if (ready != null) shown = ready.WaitOne(5000); // ctor is fast when healthy
            var splash = s_splashForm;
            if (!shown || splash == null) { HideSplash(); return; }
            SafeSplashAction(splash, delegate { splash.ShowFailure(heading, detail, logPath); });
            LogLine("[host] splash failure panel: " + heading);
        }

        // The server's own boot lines, surfaced on the splash stage while we
        // wait for its port: a slow cold start then reads as real progress
        // ("pack catalog seeded: 12 products") instead of a frozen "Starting
        // game server…" that looks like a hang. Suppressed the moment the
        // splash is gone, has failed, or startup is over.
        private static void ReportBoot(string line)
        {
            if (!s_bootingPort || string.IsNullOrEmpty(line)) return;
            var text = line.Trim();
            if (text.StartsWith("[server] ")) text = text.Substring(9).TrimStart();
            if (text.Length == 0) return;
            if (text.Length > 52) text = text.Substring(0, 51) + "...";
            SetStage(text);
        }

        // Rewrite the failure panel in place (used when the grace window runs
        // out: the panel went up saying "still waiting", it must not keep
        // saying that once we've really given up).
        private static void UpdateFailSplash(string heading, string detail)
        {
            var splash = s_splashForm;
            if (splash == null || s_splashClosed) return;
            SafeSplashAction(splash, delegate { splash.UpdateFailure(heading, detail); });
            LogLine("[host] splash failure panel: " + heading);
        }

        // Take the failure panel back down — the server answered after all.
        private static void RecoverSplash()
        {
            var splash = s_splashForm;
            if (splash == null || s_splashClosed) return;
            SafeSplashAction(splash, delegate { splash.RecoverFailure(); });
        }

        // Block (pump-free; the splash pumps itself) until the user dismisses
        // a failure panel. Returns immediately when nothing failed.
        private static void WaitForSplashExit()
        {
            var thread = s_splashThread;
            if (thread != null && thread.IsAlive) thread.Join(120000); // 2min cap
        }

        internal static void NotifySplashClosed()
        {
            s_splashThread = null;
            s_splashReady = null;
        }

        private static void SafeSplashAction(SplashForm splash, Action action)
        {
            try
            {
                if (splash.IsDisposed) return;
                if (splash.InvokeRequired) splash.BeginInvoke(action);
                else action();
            }
            catch { }
        }

        // ---------------------------------------------------------------
        // Tray behavior — the tray menu's "Open TCG Life" brings the window
        // forward (from a minimized state, or just to the front). Guarded:
        // a tray failure must never take the game down with it.
        // ---------------------------------------------------------------
        private static void RestoreFromTray(Form form)
        {
            try
            {
                form.Show();
                // Only the genuinely minimized case needs the OS restore call;
                // a visible window must keep its current state (don't downgrade
                // a maximized window to normal just because the user clicked
                // the tray icon).
                if (NativeMethods.IsIconic(form.Handle))
                    NativeMethods.ShowWindow(form.Handle, 9); // SW_RESTORE
                form.Activate();
            }
            catch { }
        }

        private static class NativeMethods
        {
            [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
            [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        }

        // The icon.png is embedded into the exe at build time
        // (csc -res:assets\icon.png,icon.png) and decoded by SplashFromIconStream.
        private static Stream EnsureIconStream()
        {
            try { return Assembly.GetExecutingAssembly().GetManifestResourceStream("icon.png"); }
            catch { return null; }
        }

        private static int ReadBE(BinaryReader r)
        {
            var b = r.ReadBytes(4);
            return (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3];
        }

        // Decode the embedded icon.png (PNG chunk walker, no System Imaging
        // dependency on x-dpi scaling quirks): find IHDR for dimensions and
        // the IDAT stream for zlib pixel data.
        private static void SplashFromIconStream(Stream stream, out int width, out int height, out byte[] pixels)
        {
            width = 0; height = 0; pixels = null;
            if (stream == null) return;
            try
            {
                using (var r = new BinaryReader(stream))
                {
                    r.ReadBytes(8); // PNG signature
                    int w = 0, h = 0, bpp = 0;
                    var idat = new MemoryStream();
                    while (true)
                    {
                        int len; try { len = ReadBE(r); } catch { break; }
                        var type = new string(r.ReadChars(4));
                        var data = r.ReadBytes(len);
                        r.ReadBytes(4); // CRC
                        if (type == "IHDR")
                        {
                            w = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];
                            h = (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7];
                            // color type 2 = truecolor RGB, 6 = truecolor RGBA
                            // (both 8-bit) — the only two make-icon.ts emits.
                            if (data[8] == 8 && (data[9] == 2 || data[9] == 6)) bpp = data[9] == 6 ? 4 : 3;
                        }
                        else if (type == "IDAT") idat.Write(data, 0, data.Length);
                        else if (type == "IEND") break;
                    }
                    if (w == 0 || h == 0 || bpp == 0) return;
                    width = w; height = h;
                    pixels = Inflate(idat.ToArray(), w, h, bpp);
                }
            }
            catch { width = 0; }
        }

        private static byte[] Inflate(byte[] zlib, int w, int h, int bpp)
        {
            // zlib wrapper is 2 bytes, adler32 trailer 4.
            var raw = new MemoryStream();
            using (var ds = new DeflateStream(
                new MemoryStream(zlib, 2, zlib.Length - 6), CompressionMode.Decompress))
                ds.CopyTo(raw);
            var data = raw.ToArray();
            // Un-filter scanlines (filters 0-4), output RGBA.
            var outPix = new byte[w * h * 4];
            int stride = w * bpp + 1;
            for (int y = 0; y < h; y++)
            {
                byte filter = data[y * stride];
                for (int x = 0; x < w; x++)
                {
                    int i = y * stride + 1 + x * bpp;
                    int a = x > 0 ? data[i - bpp] : 0;
                    int b = y > 0 ? data[(y - 1) * stride + 1 + x * bpp] : 0;
                    int c = (x > 0 && y > 0) ? data[(y - 1) * stride + 1 + (x - 1) * bpp] : 0;
                    for (int k = 0; k < bpp; k++)
                    {
                        int xv = data[i + k];
                        switch (filter)
                        {
                            case 1: xv += a; break;
                            case 2: xv += b; break;
                            case 3: xv += (a + b) / 2; break;
                            case 4: { int p = a + b - c; int pa = Math.Abs(p - a), pb = Math.Abs(p - b), pc = Math.Abs(p - c); xv += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); break; }
                        }
                        data[i + k] = (byte)xv;
                    }
                    // PNG channels are R,G,B(,A) in that order.
                    int o = (y * w + x) * 4;
                    outPix[o] = data[i];
                    outPix[o + 1] = data[i + 1];
                    outPix[o + 2] = data[i + 2];
                    outPix[o + 3] = bpp == 4 ? data[i + 3] : (byte)255; // RGB = opaque
                }
            }
            return outPix;
        }

        private sealed class SplashForm : Form
        {
            private readonly System.Windows.Forms.Timer m_Marquee;
            internal IconPanel m_Icon;
            internal Label m_Stage;
            private Panel m_FailPanel;
            private Label m_FailHead;
            private Label m_FailBody;
            private bool m_Failed;
            private int m_Phase;

            public SplashForm()
            {
                FormBorderStyle = FormBorderStyle.None;
                StartPosition = FormStartPosition.CenterScreen;
                Size = new Size(420, 560);
                AutoScaleMode = AutoScaleMode.None; // manifest DPI-aware: design in physical pixels
                BackColor = Color.FromArgb(13, 17, 32);
                ShowInTaskbar = true;
                TopMost = true;

                int w, h; byte[] px;
                SplashFromIconStream(EnsureIconStream(), out w, out h, out px);
                LogLine("[host] splash icon " + (w > 0 ? w + "x" + h : "decode failed"));

                var label = new Label
                {
                    Text = "TCG Life",
                    Font = new Font("Segoe UI", 22f, FontStyle.Bold),
                    ForeColor = Color.FromArgb(250, 204, 21),
                    AutoSize = false,
                    TextAlign = ContentAlignment.MiddleCenter,
                    Dock = DockStyle.None,
                    Bounds = new Rectangle(0, 448, 420, 48),
                    BackColor = Color.Transparent,
                };
                Controls.Add(label);

                if (w > 0) // custom-painted icon; label above it
                {
                    m_Icon = new IconPanel(w, h, px) { Bounds = new Rectangle((420 - 256) / 2, 120, 256, 256) };
                    Controls.Add(m_Icon);
                    m_Icon.BringToFront();
                    label.BringToFront();
                }

                // The PE version resource (stamped from package.json by
                // brand-exe.sh) is the source of truth — not the assembly
                // version, which csc leaves at 1.0.0.0.
                var vParts = Application.ProductVersion.Split('.');
                var version = vParts.Length >= 3 ? vParts[0] + "." + vParts[1] + "." + vParts[2] : Application.ProductVersion;
                var status = new Label
                {
                    Text = "v" + version,
                    Font = new Font("Segoe UI", 9f),
                    ForeColor = Color.FromArgb(148, 163, 184),
                    Bounds = new Rectangle(0, 498, 420, 22),
                    TextAlign = ContentAlignment.MiddleCenter,
                    BackColor = Color.Transparent,
                };
                Controls.Add(status);

                // Boot progress line — updated per stage by the main thread.
                m_Stage = new Label
                {
                    Text = "Starting up…",
                    Font = new Font("Segoe UI", 9.75f),
                    ForeColor = Color.FromArgb(226, 232, 240),
                    Bounds = new Rectangle(0, 522, 420, 22),
                    TextAlign = ContentAlignment.MiddleCenter,
                    BackColor = Color.Transparent,
                };
                Controls.Add(m_Stage);
                m_Stage.BringToFront();

                m_Marquee = new System.Windows.Forms.Timer { Interval = 420 };
                m_Marquee.Tick += (s, e) => { m_Phase = (m_Phase + 1) % 4; Invalidate(); };
                m_Marquee.Start();
            }

            protected override void OnPaint(PaintEventArgs e)
            {
                base.OnPaint(e);
                // doting dots under the title
                var g = e.Graphics;
                using (var b = new SolidBrush(Color.FromArgb(148, 163, 184)))
                {
                    for (int i = 0; i < 3; i++)
                        g.FillEllipse(b, 210 - 18 + i * 12, 552, 4, 4);
                    using (var hi = new SolidBrush(Color.FromArgb(250, 204, 21)))
                        g.FillEllipse(hi, 210 - 18 + m_Phase * 12, 552, 4, 4);
                }
            }

            internal void SetStage(string text)
            {
                if (m_Stage != null && !m_Failed) m_Stage.Text = text;
            }

            // Branded failure panel — replaces the old MessageBox. Nudges the
            // icon up to make room, stops the animation, and offers the log.
            internal void ShowFailure(string heading, string detail, string logPath)
            {
                if (m_Failed) return;
                m_Failed = true;
                if (m_Marquee != null) m_Marquee.Stop();
                if (m_Icon != null) { m_Icon.StopAnimating(); m_Icon.Top = 56; }
                if (m_Stage != null) m_Stage.Text = "";

                m_FailPanel = new Panel { BackColor = Color.FromArgb(44, 24, 28), Bounds = new Rectangle(20, 312, 380, 200) };
                var head = new Label
                {
                    Text = heading,
                    Font = new Font("Segoe UI", 12.5f, FontStyle.Bold),
                    ForeColor = Color.FromArgb(248, 113, 113),
                    Bounds = new Rectangle(16, 14, 348, 26),
                    TextAlign = ContentAlignment.MiddleLeft,
                };
                var body = new Label
                {
                    Text = detail,
                    Font = new Font("Segoe UI", 9f),
                    ForeColor = Color.FromArgb(226, 232, 240),
                    Bounds = new Rectangle(16, 46, 348, 100),
                };
                m_FailHead = head;
                m_FailBody = body;
                var logBtn = new Button
                {
                    Text = "View log",
                    FlatStyle = FlatStyle.Flat,
                    BackColor = Color.FromArgb(13, 17, 32),
                    ForeColor = Color.FromArgb(250, 204, 21),
                    Bounds = new Rectangle(16, 156, 130, 32),
                };
                logBtn.FlatAppearance.BorderColor = Color.FromArgb(250, 204, 21);
                // UseShellExecute: without it .NET 4.7+ tries to EXECUTE the
                // .log file (verified live — the button silently did nothing).
                logBtn.Click += delegate
                {
                    try
                    {
                        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(logPath) { UseShellExecute = true });
                    }
                    catch { }
                };
                var closeBtn = new Button
                {
                    Text = "Close",
                    FlatStyle = FlatStyle.Flat,
                    BackColor = Color.FromArgb(13, 17, 32),
                    ForeColor = Color.FromArgb(148, 163, 184),
                    Bounds = new Rectangle(234, 156, 130, 32),
                };
                closeBtn.FlatAppearance.BorderColor = Color.FromArgb(68, 76, 96);
                closeBtn.Click += delegate { Close(); };
                m_FailPanel.Controls.Add(head);
                m_FailPanel.Controls.Add(body);
                m_FailPanel.Controls.Add(logBtn);
                m_FailPanel.Controls.Add(closeBtn);
                Controls.Add(m_FailPanel);
                m_FailPanel.BringToFront();
                Invalidate();
            }

            // Rewrite an already-shown failure panel (grace window expired:
            // "still waiting" must become "didn't start").
            internal void UpdateFailure(string heading, string detail)
            {
                if (!m_Failed) return;
                if (m_FailHead != null) m_FailHead.Text = heading;
                if (m_FailBody != null) m_FailBody.Text = detail;
                Invalidate();
            }

            // Take the panel back down: the server answered after all. Restores
            // the icon, the marquee and the stage line so the splash reads as
            // healthy again until the window replaces it.
            internal void RecoverFailure()
            {
                if (!m_Failed) return;
                m_Failed = false;
                var panel = m_FailPanel;
                m_FailPanel = null;
                m_FailHead = null;
                m_FailBody = null;
                if (panel != null) { Controls.Remove(panel); panel.Dispose(); }
                if (m_Icon != null) m_Icon.Top = 120; // back where ShowFailure nudged it from
                if (m_Marquee != null) m_Marquee.Start();
                if (m_Stage != null) m_Stage.Text = "Starting game server…";
                Invalidate();
            }

            protected override void OnFormClosed(FormClosedEventArgs e)
            {
                base.OnFormClosed(e);
                if (m_Marquee != null) { m_Marquee.Stop(); m_Marquee.Dispose(); }
                Program.NotifySplashClosed();
            }

            // The animated card: nested control owning its own animation loop.
            internal sealed class IconPanel : Control
            {
                private readonly System.Threading.Timer m_Anim;
                private readonly Bitmap m_Bmp;
                private readonly GraphicsPath m_ClipPath;
                private readonly ColorBlend m_Blend;
                private readonly long m_T0 = Environment.TickCount;
                private int m_Frames;
                private int m_PaintQueued;

            /// <summary>Diagnostic: how many animated frames were actually painted.</summary>
            public int FramesPainted { get { return m_Frames; } }

            /// <summary>Freeze the art (failure panel shows instead).</summary>
            public void StopAnimating()
            {
                if (m_Anim != null) m_Anim.Dispose();
            }

            public IconPanel(int w, int h, byte[] px)
            {
                SetStyle(ControlStyles.OptimizedDoubleBuffer |
                         ControlStyles.UserPaint |
                         ControlStyles.AllPaintingInWmPaint, true);
                // Decode once. The old static panel re-built this bitmap on
                // every paint; an animation would have made that ~30x/second.
                m_Bmp = new Bitmap(w, h, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
                var bd = m_Bmp.LockBits(new Rectangle(0, 0, w, h), System.Drawing.Imaging.ImageLockMode.WriteOnly, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
                for (int y = 0; y < h; y++)
                    Marshal.Copy(px, y * w * 4, (IntPtr)(bd.Scan0.ToInt64() + y * bd.Stride), w * 4);
                m_Bmp.UnlockBits(bd);
                m_ClipPath = new GraphicsPath();
                m_ClipPath.AddEllipse(0, 0, w, h);
                m_Blend = new ColorBlend(3);
                m_Blend.Colors = new Color[] {
                    Color.FromArgb(0, 255, 255, 255),
                    Color.FromArgb(46, 255, 255, 255),
                    Color.FromArgb(0, 255, 255, 255) };
                m_Blend.Positions = new float[] { 0f, 0.5f, 1f };
                // A 33ms System.Threading.Timer actually fires every ~39ms
                // (15.6ms Windows timer granularity — measured 21fps cap).
                // Tick at 15ms and coalesce: at most one paint queued at a
                // time, so the loop self-paces to real paint speed.
                m_Anim = new System.Threading.Timer(_ =>
                {
                    if (Interlocked.CompareExchange(ref m_PaintQueued, 1, 0) != 0) return;
                    try { BeginInvoke((Action)(() => { m_PaintQueued = 0; m_Frames++; Invalidate(); Update(); })); }
                    catch { }
                }, null, 15, 15);
            }

            protected override void OnPaint(PaintEventArgs e)
            {
                base.OnPaint(e);
                if (m_Bmp == null) return;
                var g = e.Graphics;
                g.SmoothingMode = SmoothingMode.AntiAlias;
                float t = (Environment.TickCount - m_T0) / 1000f;
                int side = Width;
                float cx = side / 2f, cy = side / 2f;

                // 1. Pulse — a slow breath (period ~2.4s, ±3%), plus a faint
                //    "waiting for the server" glow underneath.
                float pulse = 0.97f + 0.03f * (float)Math.Sin(t * 2 * Math.PI / 2.4);
                float draw = side * pulse;
                using (var halo = new SolidBrush(Color.FromArgb((int)(60 * (0.5 + 0.5 * Math.Sin(t * 2 * Math.PI / 2.4))), 250, 204, 21)))
                    g.FillEllipse(halo, cx - draw * 0.62f, cy - draw * 0.62f, draw * 1.24f, draw * 1.24f);
                g.InterpolationMode = InterpolationMode.HighQualityBilinear; // bicubic cost ~2x, invisible at ±3%
                g.DrawImage(m_Bmp, cx - draw / 2, cy - draw / 2, draw, draw);

                // 2. Shine — one soft gloss band sweeping diagonally every 2.2s.
                float period = 2.2f;
                float ph = (t % period) / period;
                float sweep = (ph * (2.8f) - 0.9f) * side; // crosses the icon, then rests
                // Band in local (path) space; TranslateTransform aligns the
                // cached 256-clip with the pulsed draw size every frame.
                var band = new RectangleF(-draw * 0.7f + sweep, -draw * 1.2f, draw * 0.22f, draw * 2.4f);
                using (var p = new LinearGradientBrush(
                    new PointF(band.Left, band.Top), new PointF(band.Right, band.Bottom),
                    Color.FromArgb(0, 255, 255, 255), Color.FromArgb(0, 255, 255, 255)))
                {
                    p.InterpolationColors = m_Blend;
                    g.TranslateTransform(cx - draw / 2, cy - draw / 2);
                    g.SetClip(m_ClipPath);
                    g.FillRectangle(p, band);
                    g.ResetClip();
                    g.ResetTransform();
                }
            }

            protected override void OnHandleDestroyed(EventArgs e)
            {
                base.OnHandleDestroyed(e);
                if (m_Anim != null) { m_Anim.Dispose(); }
                if (m_Bmp != null) m_Bmp.Dispose();
                if (m_ClipPath != null) m_ClipPath.Dispose();
            }
            }
        }

        private static void LogLine(string line)
        {
            try { if (line != null) s_serverLog.WriteLine(line); } catch { }
        }

        // ---------------------------------------------------------------
        // Window layout persistence — remembers size/position/maximized
        // between launches in %LOCALAPPDATA%\TCGLife\window.txt (next to
        // the webview profile, so the release folder stays clean).
        // Corrupt or off-screen saves (unplugged monitor) fall back to the
        // centered default.
        // ---------------------------------------------------------------
        private sealed class WindowLayout
        {
            public bool UseDefault = true;
            public bool Maximized;
            public System.Drawing.Rectangle Bounds = new System.Drawing.Rectangle(0, 0, 1440, 940);
        }

        private static WindowLayout LoadWindowLayout()
        {
            var layout = new WindowLayout();
            try
            {
                var path = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "TCGLife", "window.txt");
                if (!File.Exists(path)) return layout;

                int x = 0, y = 0, w = 0, h = 0, max = 0;
                bool hasPos = false, hasSize = false;
                foreach (var line in File.ReadAllLines(path))
                {
                    var i = line.IndexOf('=');
                    if (i <= 0) continue;
                    int v;
                    if (!int.TryParse(line.Substring(i + 1).Trim(), out v)) continue;
                    switch (line.Substring(0, i).Trim())
                    {
                        case "x": x = v; hasPos = true; break;
                        case "y": y = v; hasPos = true; break;
                        case "w": w = v; hasSize = true; break;
                        case "h": h = v; hasSize = true; break;
                        case "max": max = v; break;
                    }
                }
                if (!hasPos || !hasSize) return layout;
                if (w < 1024) w = 1024; // never smaller than MinimumSize
                if (h < 700) h = 700;

                var bounds = new System.Drawing.Rectangle(x, y, w, h);
                var visible = false;
                foreach (var screen in Screen.AllScreens)
                    if (screen.WorkingArea.IntersectsWith(bounds)) { visible = true; break; }
                if (!visible) return layout;

                layout.Bounds = bounds;
                layout.Maximized = max != 0;
                layout.UseDefault = false;
            }
            catch { }
            return layout;
        }

        private static void SaveWindowLayout(Form form)
        {
            try
            {
                var dir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "TCGLife");
                Directory.CreateDirectory(dir);
                // Maximized (incl. F11 fullscreen): persist the restore geometry.
                var b = form.WindowState == FormWindowState.Normal ? form.DesktopBounds : form.RestoreBounds;
                var max = form.WindowState == FormWindowState.Maximized ? 1 : 0;
                File.WriteAllText(
                    Path.Combine(dir, "window.txt"),
                    "x=" + b.X + "\r\n" +
                    "y=" + b.Y + "\r\n" +
                    "w=" + b.Width + "\r\n" +
                    "h=" + b.Height + "\r\n" +
                    "max=" + max + "\r\n");
            }
            catch { }
        }

        private static void TryInvoke(Control c, Action a)
        {
            try { if (c.IsHandleCreated && !c.IsDisposed) c.BeginInvoke(a); } catch { }
        }

        private static void TryKill(Process p)
        {
            try { if (p != null && !p.HasExited) p.Kill(); } catch { }
        }

        // The server prints its actual URL once it is listening. This is the
        // only port the window will ever load, so a dev server on 8787 (or any
        // other listener) cannot be mistaken for the game.
        private static int ParseGamePort(string line)
        {
            const string marker = "Game UI: http://localhost:";
            if (string.IsNullOrEmpty(line)) return 0;
            int at = line.IndexOf(marker, StringComparison.Ordinal);
            if (at < 0) return 0;
            int start = at + marker.Length;
            int end = line.IndexOf('/', start);
            if (end < 0) return 0;
            int port;
            return int.TryParse(line.Substring(start, end - start), out port) && port > 0 ? port : 0;
        }

        private static bool WaitPortAnnouncement(int timeoutMs, Process watch)
        {
            var deadline = Environment.TickCount + timeoutMs;
            while (Environment.TickCount < deadline)
            {
                if (s_splashClosed) return false;
                if (watch != null && watch.HasExited) return false;
                if (s_portReady.Wait(200)) return true;
                Application.DoEvents();
            }
            return false;
        }

        private static bool WaitGame(int timeoutMs, Process watch)
        {
            if (!WaitPortAnnouncement(timeoutMs, watch)) return false;
            return WaitPort("127.0.0.1", s_port, Math.Min(timeoutMs, 15000), watch);
        }

        // Wait for a port to answer. `watch` (the server process) makes a
        // dead child fail fast instead of spinning out the whole budget, and a
        // dismissed splash ends the wait too — nothing left to show for it.
        private static bool WaitPort(string host, int port, int timeoutMs, Process watch)
        {
            var deadline = Environment.TickCount + timeoutMs;
            while (Environment.TickCount < deadline)
            {
                if (s_splashClosed) return false;
                if (watch != null && watch.HasExited) return false;
                try
                {
                    using (var c = new TcpClient())
                    {
                        var ar = c.BeginConnect(host, port, null, null);
                        if (ar.AsyncWaitHandle.WaitOne(500) && c.Connected) { c.EndConnect(ar); return true; }
                        c.Close();
                    }
                }
                catch { }
                Application.DoEvents(); // keep the (not yet shown) message loop healthy
                Thread.Sleep(200);
            }
            return false;
        }
    }
}
