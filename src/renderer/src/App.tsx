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
import { chromaFor, GRAPHITE } from "@core/hue.js";
import { DEFAULT_SETTINGS } from "@core/settings.js";
import type { WikiApi } from "@shared/api.js";
import { Accent } from "./Accent.js";
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
    // with its chroma drained, not a second palette (`core/hue.ts`).
    document.documentElement.style.setProperty(
      "--project-chroma",
      String(chromaFor(hue)),
    );
  });

  return (
    <Chrome
      header={
        <Show
          when={project()}
          fallback={<PlainTitle title="Inchworm" />}
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
      {/* A pending resource reads as `undefined`, exactly like "no project" —
          without this the picker flashes in every project window. */}
      <Show
        when={!project.loading}
        fallback={<p class="p-6 text-status-muted">Opening…</p>}
      >
        <Show when={project()} fallback={
            <Picker
              api={props.api}
              settings={settings() ?? DEFAULT_SETTINGS}
              onSettings={() => {
                setSettingsOpen(true);
              }}
            />
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
