import React, {Component} from "react";
import {THEME_STATE, ThemeState} from "./reducer";
import {
  SET_STICKER_TYPE,
  SET_THEME,
  STICKER_UPDATED,
  SYSTEM_THEME_CHANGED,
  TOGGLE_FONT,
  TOGGLE_STICKER,
  TOGGLE_WALLPAPER,
} from "./settings";
import path from "path";
import {attemptToUpdateSticker, resolveLocalStickerPath} from "./StickerUpdateService";
import {ipcRenderer} from "electron";
import fs from "fs";

// ───────────────────────────────────────────────────────────────
// Archivo de estado de Konsole
// ───────────────────────────────────────────────────────────────
const STATE_FILE = "/tmp/konsole_current_profile";

const passProps = (uid: any, parentProps: any, props: any) =>
  Object.assign(props, {
    [THEME_STATE]: parentProps[THEME_STATE],
  });

export const mapTermsState = (state: any, map: any) => {
  return Object.assign(map, {
    [THEME_STATE]: state.ui[THEME_STATE],
  });
};

export const mapHyperState = mapTermsState;
export const getTermGroupProps = passProps;
export const getTermProps = passProps;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const decorateHyper = (Hyper: any) =>
  class HyperDecorator extends Component<any> {
    render() {
      return <Hyper {...this.props} />;
    }
  };

declare global {
  interface Window {
    config: any;
    rpc: any;
    store: any;
  }

  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Electron {
    interface App {
      getWindows: () => BrowserWindow[];
      getLastFocusedWindow: () => BrowserWindow;
    }

    interface BrowserWindow {
      rpc: any;
    }
  }
}

export const CONFIG_RELOAD = "CONFIG_RELOAD";

export function reloadConfig(config: any) {
  const now = Date.now();
  return {
    type: CONFIG_RELOAD,
    config,
    now,
  };
}

interface StickerState {
  imageLoaded: boolean;
}

const createCacheBuster = () => new Date().valueOf().toString(32);

let initialized = false;

export const decorateTerm = (Term: any) => {
  let cacheBuster: string = createCacheBuster();
  return class TerminalDecorator extends Component<any, StickerState> {
    state = {
      imageLoaded: false,
    };

    private mediaCheckInterval: any = null;

    private static imageError() {
      cacheBuster = createCacheBuster();
    }

    private static constructStickerUrl(
      themeState: ThemeState
    ): string | undefined {
      const localStickerPath = resolveLocalStickerPath(
        themeState.currentSticker.sticker
      ).replace(path.sep, "/");
      return `${localStickerPath}?time=${cacheBuster}`;
    }

    /**
     * Lee el archivo de estado de Konsole y determina si es modo oscuro.
     * Ajusta la comprobación según el contenido real del archivo.
     */
    public static isDark(): boolean {
      try {
        if (fs.existsSync(STATE_FILE)) {
          const content = fs
            .readFileSync(STATE_FILE, "utf8")
            .trim()
            .toLowerCase();
          // Si contiene "nightmare" → oscuro
          // Si contiene "kurumi"    → claro
          if (content.includes("nightmare")) return true;
          if (content.includes("kurumi")) return false;
        }
      } catch (e) {
        console.error("[doki-theme-hyper] Error leyendo STATE_FILE:", e);
      }
      // Fallback
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }

    /*private static handleMediaChange() {
      const isDark = TerminalDecorator.isDark();

      const previousState = window.store.getState().ui[THEME_STATE];
      const previousIsDark = previousState?.systemState === 1; // DARK = 1

      if (isDark === previousIsDark && previousState?.activeTheme) return;

      window.store.dispatch({
        type: SYSTEM_THEME_CHANGED,
        payload: { isDark },
      });
      window.store.dispatch(reloadConfig(window.config.getConfig()));
    }*/
    private static handleMediaChange() {
			const isDark = TerminalDecorator.isDark();
			const state = window.store.getState().ui[THEME_STATE];
			const previousIsDark = state?.systemState === 1;
			const expectedStickerPath = isDark ? "/dark/" : "/light/";
			const stickerIsCorrect = state?.currentSticker?.sticker?.path?.includes(expectedStickerPath);
			
			if (isDark === previousIsDark && state?.activeTheme && stickerIsCorrect) return;
			window.store.dispatch({
				type: SYSTEM_THEME_CHANGED,
				payload: { isDark }
			});
			window.store.dispatch(reloadConfig(window.config.getConfig()));
		}

    componentDidMount() {
      if (!initialized) {
        this.registerListener(SET_THEME);
        this.registerListener(SET_STICKER_TYPE);
        this.registerListener(STICKER_UPDATED);
        this.registerListener(TOGGLE_WALLPAPER);
        window.rpc.on(TOGGLE_FONT, () => {
          window.store.dispatch(reloadConfig(window.config.getConfig()));
        });
        ipcRenderer.on(STICKER_UPDATED, () => {
          this.forceUpdate();
          window.store.dispatch({
            type: "RE_RENDER_PLZ",
          });
        });
        window.rpc.on(TOGGLE_STICKER, () => {
          window.store.dispatch({ type: TOGGLE_STICKER });
        });
        window.rpc.on(TOGGLE_WALLPAPER, () => {
          window.store.dispatch({ type: TOGGLE_WALLPAPER });
        });

        // Inicializar
        TerminalDecorator.handleMediaChange();

        // Polling cada 2s leyendo /tmp/konsole_current_profile
        this.mediaCheckInterval = setInterval(() => {
          TerminalDecorator.handleMediaChange();
        }, 2000);

        initialized = true;
      }
    }

    componentWillUnmount() {
      if (this.mediaCheckInterval) {
        clearInterval(this.mediaCheckInterval);
        this.mediaCheckInterval = null;
      }
    }

    private registerListener(event: string) {
      window.rpc.on(event, (eventPayload: any) => {
        window.store.dispatch({
          type: event,
          payload: eventPayload,
        });
        window.store.dispatch(reloadConfig(window.config.getConfig()));
        ipcRenderer.send(event, eventPayload);
      });
    }

    componentWillReceiveProps(nextProps: any) {
      const themeState: ThemeState = this.props[THEME_STATE];
      const nextThemeState: ThemeState = nextProps[THEME_STATE];
      if (
        themeState.currentSticker.sticker.path !==
        nextThemeState.currentSticker.sticker.path
      ) {
        this.setState({ imageLoaded: false });
        cacheBuster = createCacheBuster();
      }

      if (
        themeState.activeTheme.information.id !==
        nextThemeState.activeTheme.information.id
      ) {
        window.store.dispatch(reloadConfig(window.config.getConfig()));
        attemptToUpdateSticker().then(() => {
          window.store.dispatch(reloadConfig(window.config.getConfig()));
        });
      }
    }

    render() {
      const themeState: ThemeState = this.props[THEME_STATE];

      const imageStyle =
        window.screen.width <= 1920
          ? { maxHeight: "200px", maxWidth: "175px" }
          : {};
      return (
        <div style={{ width: "100%", height: "100%", position: "relative" }}>
          {React.createElement(Term, Object.assign({}, this.props))}
          <div
            style={{
              position: "absolute",
              bottom: "0.5rem",
              right: "0.5rem",
              color: "black",
            }}
          >
            {themeState.showSticker ? (
              <img
                key={themeState.currentSticker.sticker.path}
                style={
                  this.state.imageLoaded ? imageStyle : { display: "none" }
                }
                onLoad={() => this.setLoaded()}
                onError={() => TerminalDecorator.imageError()}
                src={TerminalDecorator.constructStickerUrl(themeState)}
                alt={themeState.currentSticker.sticker.name}
              />
            ) : (
              <></>
            )}
          </div>
        </div>
      );
    }

    private setLoaded() {
      this.setState({ imageLoaded: true });
    }
  };
};
