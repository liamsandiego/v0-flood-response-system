"""
RapidRelay – Convert XGBoost model to ONNX format for Vercel deployment.

Usage:
    cd Rapid-Relay-Pre-Prototype-main/flood_preprototype
    pip install xgboost onnxmltools skl2onnx onnxruntime
    python scripts/export_onnx.py

Outputs:
    models/trained/flood_xgb_model.onnx

The ONNX model can then be used in a Next.js API route via onnxruntime-node.
"""

import sys
from pathlib import Path

import numpy as np
import xgboost as xgb
from onnxmltools import convert_xgboost
from onnxmltools.convert.common.data_types import FloatTensorType

# 13 features — must match FEATURE_COLUMNS in prediction_service.py
FEATURE_COLUMNS = [
    "max_water_level_6h",
    "max_water_level_24h",
    "water_level_slope_3h",
    "water_level_slope_6h",
    "water_level_std_24h",
    "rainfall_sum_1h",
    "rainfall_sum_6h",
    "rainfall_sum_24h",
    "rainfall_max_intensity",
    "humidity_mean_24h",
    "humidity_trend_6h",
    "soil_saturation",
    "soil_saturation_mean_24h",
]

MODEL_DIR = Path(__file__).resolve().parent.parent / "models" / "trained"
INPUT_PATH = MODEL_DIR / "flood_xgb_model.json"
OUTPUT_PATH = MODEL_DIR / "flood_xgb_model.onnx"

# Also copy to the frontend public dir for Vercel deployment
FRONTEND_OUTPUT = Path(__file__).resolve().parent.parent.parent.parent / "v0-flood-response-system" / "public" / "models" / "flood_xgb_model.onnx"


def main():
    if not INPUT_PATH.exists():
        print(f"ERROR: Model not found at {INPUT_PATH}")
        sys.exit(1)

    print(f"Loading XGBoost model from {INPUT_PATH}")
    model = xgb.XGBClassifier()
    model.load_model(str(INPUT_PATH))

    print(f"Converting to ONNX ({len(FEATURE_COLUMNS)} features)")
    initial_type = [("features", FloatTensorType([None, len(FEATURE_COLUMNS)]))]
    onnx_model = convert_xgboost(model, initial_types=initial_type, target_opset=12)

    # Save to ML directory
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "wb") as f:
        f.write(onnx_model.SerializeToString())
    print(f"Saved ONNX model to {OUTPUT_PATH}")

    # Also save to frontend public directory for Vercel
    FRONTEND_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(FRONTEND_OUTPUT, "wb") as f:
        f.write(onnx_model.SerializeToString())
    print(f"Saved ONNX model to {FRONTEND_OUTPUT}")

    # Verify with onnxruntime
    import onnxruntime as ort
    session = ort.InferenceSession(str(OUTPUT_PATH))
    test_input = np.zeros((1, len(FEATURE_COLUMNS)), dtype=np.float32)
    results = session.run(None, {"features": test_input})
    print(f"Verification — test prediction: class={results[0][0]}, probabilities={results[1][0]}")
    print("ONNX export complete!")


if __name__ == "__main__":
    main()
