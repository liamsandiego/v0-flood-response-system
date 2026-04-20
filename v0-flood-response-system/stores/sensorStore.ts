// =============================================================================
// RapidRelay – Global State Store (Zustand)
//
// Single source of truth for sensor data, predictions, alerts, and connection
// state. Designed for real-time updates via WebSocket with minimal re-renders.
// =============================================================================

import { create } from "zustand";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SensorProperties {
  sensor_id: string;
  name: string;
  type: string;
  latitude: number;
  longitude: number;
  water_level: number | null;
  rainfall: number | null;
  humidity: number | null;
  temperature: number | null;
  soil_moisture: number | null;
  pressure: number | null;
  is_valid: boolean;
  timestamp: string;
  flood_mode: boolean;
}

export interface GeoJSONFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: SensorProperties;
}

export interface SensorGeoJSON {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
}

export interface Prediction {
  flood_probability: number;
  alert_level: "CLEAR" | "WATCH" | "WARNING" | "DANGER";
  features_used: Record<string, number>;
  method: "xgboost" | "rule_based" | "no_data";
  timestamp: string;
}

export type AlertLevel = "CLEAR" | "WATCH" | "WARNING" | "DANGER";
export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "polling"
  | "disabled"
  | "disconnected"
  | "error";

export interface SensorHistoryEntry {
  timestamp: string;
  water_level: number;
  rainfall: number;
  humidity: number;
  temperature: number;
  pressure: number;
  risk: number;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface FloodStore {
  // Sensor data
  sensorData: SensorGeoJSON;
  sensorHistory: Map<string, SensorHistoryEntry[]>;

  // ML prediction
  prediction: Prediction | null;

  // Alert state
  alertLevel: AlertLevel;
  criticalMode: boolean;
  alertMessage: string | null;
  alertDismissed: boolean;

  // Connection
  wsStatus: ConnectionStatus;
  lastUpdate: Date | null;
  tick: number;
  clientCount: number;

  // UI Preferences
  unit: "metric" | "imperial";
  temperatureUnit: "celsius" | "fahrenheit";

  // Actions
  updateSensors: (data: SensorGeoJSON) => void;
  updatePrediction: (pred: Prediction) => void;
  setWsStatus: (status: ConnectionStatus) => void;
  setTick: (tick: number, clients: number) => void;
  dismissAlert: () => void;
  triggerCriticalMode: (message: string) => void;
  resetCriticalMode: () => void;
  setUnit: (unit: "metric" | "imperial") => void;
  setTemperatureUnit: (unit: "celsius" | "fahrenheit") => void;
}

const MAX_HISTORY = 120; // 10 minutes at 5s intervals

export const useFloodStore = create<FloodStore>((set, get) => ({
  // Initial state
  sensorData: { type: "FeatureCollection", features: [] },
  sensorHistory: new Map(),
  prediction: null,
  alertLevel: "CLEAR",
  criticalMode: false,
  alertMessage: null,
  alertDismissed: false,
  wsStatus: "disconnected",
  lastUpdate: null,
  tick: 0,
  clientCount: 0,
  unit: "metric",
  temperatureUnit: "celsius",

  // Actions
  updateSensors: (data) => {
    const previousFeatures = get().sensorData.features;
    if (previousFeatures.length === data.features.length) {
      const prevBySensor = new Map(
        previousFeatures.map((f) => [f.properties.sensor_id, f.properties.timestamp])
      );
      const unchanged = data.features.every(
        (f) => prevBySensor.get(f.properties.sensor_id) === f.properties.timestamp
      );
      if (unchanged) {
        return;
      }
    }

    const history = new Map(get().sensorHistory);

    for (const feature of data.features) {
      const id = feature.properties.sensor_id;
      const entries = history.get(id) || [];
      entries.push({
        timestamp: feature.properties.timestamp,
        water_level: feature.properties.water_level ?? 0,
        rainfall: feature.properties.rainfall ?? 0,
        humidity: feature.properties.humidity ?? 0,
        temperature: feature.properties.temperature ?? 0,
        pressure: feature.properties.pressure ?? 0,
        risk: 0,
      });
      if (entries.length > MAX_HISTORY) entries.shift();
      history.set(id, entries);
    }

    set({ sensorData: data, sensorHistory: history, lastUpdate: new Date() });
  },

  updatePrediction: (pred) => {
    const prevLevel = get().alertLevel;
    const newLevel = pred.alert_level;

    // Auto-trigger critical mode on DANGER
    const criticalMode =
      newLevel === "DANGER" ? true : newLevel === "CLEAR" ? false : get().criticalMode;

    // Generate alert message on level change
    let alertMessage = get().alertMessage;
    let alertDismissed = get().alertDismissed;
    if (newLevel !== prevLevel && (newLevel === "DANGER" || newLevel === "WARNING")) {
      alertMessage =
        newLevel === "DANGER"
          ? "FLOOD DANGER — Evacuate flood-prone areas immediately"
          : "FLOOD WARNING — Monitor water levels closely";
      alertDismissed = false;
    }

    set({
      prediction: pred,
      alertLevel: newLevel,
      criticalMode,
      alertMessage,
      alertDismissed,
    });
  },

  setWsStatus: (status) => set({ wsStatus: status }),
  setTick: (tick, clients) => set({ tick, clientCount: clients }),
  dismissAlert: () => set({ alertDismissed: true }),

  triggerCriticalMode: (message) =>
    set({ criticalMode: true, alertLevel: "DANGER", alertMessage: message, alertDismissed: false }),

  resetCriticalMode: () =>
    set({ criticalMode: false, alertLevel: "CLEAR", alertMessage: null }),

  setUnit: (unit) => {
    set({ unit });
    if (typeof window !== "undefined") {
      localStorage.setItem("rapidrelay_unit", unit);
    }
  },

  setTemperatureUnit: (temperatureUnit) => {
    set({ temperatureUnit });
    if (typeof window !== "undefined") {
      localStorage.setItem("rapidrelay_temperature_unit", temperatureUnit);
    }
  },
}));

// Hydrate unit preference from localStorage on first load
if (typeof window !== "undefined") {
  const saved = localStorage.getItem("rapidrelay_unit");
  if (saved === "metric" || saved === "imperial") {
    useFloodStore.setState({ unit: saved });
  }

  const savedTemperature = localStorage.getItem("rapidrelay_temperature_unit");
  if (savedTemperature === "celsius" || savedTemperature === "fahrenheit") {
    useFloodStore.setState({ temperatureUnit: savedTemperature });
  }
}
