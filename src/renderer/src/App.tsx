/**
 * The window shell: one window, one project — or, with no project, the front
 * door. This file owns what is true of a window whatever it is showing: the
 * bridge, the title bar, the settings sheet, and the accent hue that every
 * other colour in the window is derived from.
 */

import {
  createEffect,
  createResource,
  createSignal,
  ErrorBoundary,
  onCleanup,
  Show,
  type JSX,
} from "solid-js";
import { AGENT_CHROMA, chromaFor, GRAPHITE } from "@core/hue.js";
import { basename } from "@core/paths.js";
import { DEFAULT_SETTINGS } from "@core/settings.js";
import type { WikiApi } from "@shared/api.js";
import { Accent } from "./Accent.js";
import { AgentWindow } from "./AgentWindow.js";
import { bridge } from "./bridge.js";
import { createCommandHub } from "./commands.js";
import { Picker } from "./Picker.js";
import { applyProjectEvent } from "./projectEvent.js";
import { ProjectView } from "./ProjectView.js";
import { Settings } from "./Settings.js";
import { Sheet } from "./Sheet.js";

/**
 * A failure state is still a view, so it carries its own heading: `role="alert"`
 * replaces the heading role, and an `h1` that is also the alert leaves the
 * document outline empty.
 */

const Failure = (props: { readonly children: JSX.Element }): JSX.Element => (
  <div class="p-6">
    <h1 class="font-semibold">Inchworm</h1>
    <p role="alert" class="mt-2 text-status-over">
      {props.children}
    </p>
  </div>
);

const Chrome = (props: {
  readonly header: JSX.Element;
  readonly children: JSX.Element;
}): JSX.Element => (
  <div class="flex h-screen flex-col">
    <div class="h-1 w-full bg-accent" />
    <header class="drag flex h-11 shrink-0 items-center gap-2 pl-24 font-medium">
      {props.header}
    </header>
    <main class="flex min-h-0 flex-1 flex-col border-t border-hairline">
      {props.children}
    </main>
  </div>
);

/** The title bar of a window with no project to name: the glyph, unlinked. */
/**
 * The title of a window with no project: the app's name and nothing else.
 *
 * No diamond. The diamond is `Accent`'s — it is filled with `--accent`, it says
 * *which project this window is*, and clicking it changes that colour. A window
 * with no project has no identity to state and no hue to change, so the mark
 * drawn here was the colour picker's shape with none of its meaning.
 */
const PlainTitle = (props: { readonly title: string }): JSX.Element => (
  <span>{props.title}</span>
);

/**
 * The window shell. A window is bound to one project for its lifetime, so this
 * asks main once which project it *is* and then only ever updates in place:
 * the file list from a watcher event, the hue from an accent broadcast — both
 * of which arrive in every window on the project, not just the one that
 * acted.
 */
const Window = (props: { readonly api: WikiApi }): JSX.Element => {
  const [project, { mutate }] = createResource(() =>
    props.api.currentProject(),
  );
  /**
   * The folder this window is an **agent window** for, if it is one. Asked for
   * beside the project rather than instead of it: a window is one or the other,
   * and only main knows which — the renderer would otherwise have to guess from
   * "no project", which is also what the picker is.
   */
  const [pending] = createResource(() => props.api.currentPending());
  const [picking, setPicking] = createSignal(false);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const hub = createCommandHub(props.api);

  /**
   * The app's settings, in every window. Fetched once and then only ever
   * updated by the broadcast, exactly like the project: a change made in one
   * window must reach the launcher menu in all of them.
   */
  const [settings, { mutate: mutateSettings }] = createResource(() =>
    props.api.getSettings(),
  );
  onCleanup(props.api.onSettings((next) => mutateSettings(next)));

  // ⌘⇧O in a window that *is* the picker would open the picker over itself;
  // main sends the command to every window because only the view knows which
  // it is.
  hub.listen((command) => {
    if (command.kind === "projects" && project() !== undefined) setPicking(true);
    // ⌘, reaches every window, including the picker — the settings are the
    // app's, not a project's.
    if (command.kind === "settings") setSettingsOpen(true);
  });

  onCleanup(
    props.api.onProjectEvent((event) => {
      mutate((current) =>
        current === undefined ? current : applyProjectEvent(current, event),
      );
    }),
  );

  // One number crosses IPC and one custom property changes; every accent token
  // is an OKLCH expression over it, so the repaint is CSS, not a re-render.
  createEffect(() => {
    // A window with no project has no identity to wear, and graphite is the
    // slot that says so — the ramp with its chroma drained, not a colour
    // borrowed from a project that is not open.
    const hue = project()?.hue ?? GRAPHITE;
    document.documentElement.style.setProperty("--project-hue", String(hue));
    // Two numbers now, still one identity: the graphite slot is the same ramp
    // with its chroma drained, not a second palette (`core/hue.ts`). An agent
    // window drains it the rest of the way — a true neutral is the one thing no
    // project can be wearing, which is what makes that window recognisable
    // beside the projects it is not.
    document.documentElement.style.setProperty(
      "--project-chroma",
      // The project decides, whenever there is one: a window that has a project
      // is a project window whatever folder it once refused, and a colourless
      // project window would be this rule failing silently.
      String(project() !== undefined || pending() === undefined ? chromaFor(hue) : AGENT_CHROMA),
    );
  });

  return (
    <Chrome
      header={
        <Show
          when={project()}
          fallback={
            <PlainTitle
              title={
                // An agent window is about a folder, so the folder is what it
                // is called — in the title bar and in the Window menu, which is
                // where several of these are told apart.
                pending() === undefined
                  ? "Inchworm"
                  : basename(pending()?.dir ?? "")
              }
            />
          }
        >
          {(snapshot) => (
            <Accent
              api={props.api}
              hue={snapshot().hue}
              name={snapshot().name}
            />
          )}
        </Show>
      }
    >
      {/* An unsettled resource reads as `undefined`, exactly like "no project"
          and "no folder" — without this the picker flashes in every project
          window, and in every agent window too. */}
      <Show
        when={!project.loading && !pending.loading}
        fallback={<p class="p-6 text-status-muted">Opening…</p>}
      >
        <Show when={project()} fallback={
            // Three kinds of window, and the fallback holds the two that have
            // no project: the front door, and a folder with an agent in it.
            <Show
              when={pending()}
              fallback={
                <Picker
                  api={props.api}
                  settings={settings() ?? DEFAULT_SETTINGS}
                  onSettings={() => {
                    setSettingsOpen(true);
                  }}
                />
              }
            >
              {(folder) => (
                // The *settled* settings, not the default standing in for
                // them: this window starts its agent the moment it mounts, and
                // a fallback here would start whichever agent the app ships
                // with rather than the one the reader chose.
                <Show
                  when={settings()}
                  fallback={<p class="p-6 text-status-muted">Opening…</p>}
                >
                  {(ready) => (
                    <AgentWindow
                      api={props.api}
                      pending={folder()}
                      settings={ready()}
                    />
                  )}
                </Show>
              )}
            </Show>
          }>
          {(snapshot) => (
            <>
              <ProjectView
                api={props.api}
                project={snapshot()}
                hub={hub}
                settings={settings() ?? DEFAULT_SETTINGS}
                today={() =>
                  // The local day, in the shape the registers use. `toISOString`
                  // is UTC and would date an evening entry tomorrow.
                  new Date().toLocaleDateString('en-CA')
                }
              />
              <Sheet
                open={picking()}
                label="Projects"
                onClose={() => {
                  setPicking(false);
                }}
              >
                {/* Mounted with the sheet, not with the window: `Picker` asks
                    main for the project list, and a window that never opens the
                    sheet should never ask. */}
                <Show when={picking()}>
                  <Picker
                    api={props.api}
                    settings={settings() ?? DEFAULT_SETTINGS}
                    variant="sheet"
                    onOpened={() => {
                      setPicking(false);
                    }}
                  />
                </Show>
              </Sheet>
            </>
          )}
        </Show>
      </Show>

      {/* Outside the project ⇄ picker split, because ⌘, belongs to both: the
          settings are the app's own, and the picker's bootstrap sheet runs the
          same launchers a project window does. */}
      <Sheet
        open={settingsOpen()}
        label="Settings"
        onClose={() => {
          setSettingsOpen(false);
        }}
      >
        <Show when={settingsOpen()}>
          <Settings
            api={props.api}
            settings={settings() ?? DEFAULT_SETTINGS}
            onClose={() => {
              setSettingsOpen(false);
            }}
          />
        </Show>
      </Sheet>
    </Chrome>
  );
};

export const App = (): JSX.Element => {
  const api = bridge();

  return (
    <ErrorBoundary
      fallback={(error: unknown) => (
        <Chrome header={<PlainTitle title="Inchworm" />}>
          <Failure>
            Failed: {error instanceof Error ? error.message : String(error)}
          </Failure>
        </Chrome>
      )}
    >
      <Show
        when={api}
        fallback={
          <Chrome header={<PlainTitle title="Inchworm" />}>
            <Failure>
              No bridge: this renderer is running without its preload script.
            </Failure>
          </Chrome>
        }
      >
        {(present) => <Window api={present()} />}
      </Show>
    </ErrorBoundary>
  );
};
