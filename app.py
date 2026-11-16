import os
import sys
import uuid
from pathlib import Path

import gdown
import numpy as np
import tensorflow as tf
from flask import Flask, jsonify, render_template, request
from flask_cors import CORS

try:
    from tensorflow.keras.utils import img_to_array, load_img
except ImportError:
    from tensorflow.keras.preprocessing.image import img_to_array, load_img


BASE_DIR = Path(__file__).resolve().parent
MODEL_DIR = BASE_DIR / "models"

# Must match the file name stored on Google Drive (`Content-Disposition`), so the
# on-disk artifact and the remote source stay unambiguous.
MODEL_FILENAME = "Mango_Leaf_disease_detector.keras"
MODEL_PATH = MODEL_DIR / MODEL_FILENAME

# Earlier releases saved the same Drive file under this name. Reuse it instead of
# downloading ~100 MB again.
LEGACY_MODEL_PATH = MODEL_DIR / "disease_detector.keras"

UPLOAD_DIR = BASE_DIR / "uploads"

# Google Drive model file (direct download link)
MODEL_URL = "https://drive.google.com/uc?id=1JK5WqTkNuKq5uPXIZmneB_3Hvb4Uuqsu"

# Allowed file types
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif"}
MAX_CONTENT_LENGTH = 10 * 1024 * 1024  # 10 MB

# Flask app
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH
CORS(app)

# Label map
label_map = {
    0: "Anthracnose",
    1: "Bacterial Canker",
    2: "Cutting Weevil",
    3: "Die Back",
    4: "Gall Midge",
    5: "Healthy",
    6: "Powdery Mildew",
    7: "Sooty Mould",
}


def download_model():
    """Download the trained model if it is not available locally."""
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    if LEGACY_MODEL_PATH.is_file() and not MODEL_PATH.is_file():
        print(f"Found model at {LEGACY_MODEL_PATH}. Renaming to {MODEL_FILENAME}...")
        LEGACY_MODEL_PATH.replace(MODEL_PATH)
        return

    print(f"Model not found at {MODEL_PATH}. Downloading from Google Drive...")
    downloaded = gdown.download(MODEL_URL, str(MODEL_PATH), quiet=False)
    if downloaded is None or not MODEL_PATH.is_file():
        raise RuntimeError(
            f"Could not download the model to {MODEL_PATH}. "
            "Download it manually and place it there."
        )

    print(f"Saved model to {MODEL_PATH}")


if not MODEL_PATH.is_file():
    download_model()

# Load model (compile=False: the app only needs inference)
model = tf.keras.models.load_model(str(MODEL_PATH), compile=False)


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/health")
def health():
    return jsonify({"status": "ok"})


@app.errorhandler(413)
def file_too_large(_error):
    max_mb = MAX_CONTENT_LENGTH // (1024 * 1024)
    return jsonify({"error": f"File is too large. Maximum size is {max_mb} MB."}), 413


@app.route("/predict", methods=["POST"])
def predict():
    uploaded = request.files.get("file")

    if uploaded is None:
        return jsonify({"error": "No file uploaded"}), 400
    if not uploaded.filename:
        return jsonify({"error": "Empty filename"}), 400
    if not allowed_file(uploaded.filename):
        return jsonify({"error": "Invalid file format. Allowed: png, jpg, jpeg, gif"}), 400

    # A unique name prevents concurrent uploads from overwriting each other.
    # The extension was validated above, so it is safe to reuse.
    extension = uploaded.filename.rsplit(".", 1)[1].lower()
    filepath = UPLOAD_DIR / f"{uuid.uuid4().hex}.{extension}"
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    try:
        uploaded.save(filepath)

        # Preprocess image
        img = load_img(filepath, target_size=(224, 224))
        img_array = img_to_array(img) / 255.0
        img_array = np.expand_dims(img_array, axis=0)

        # Predict
        predictions = model.predict(img_array, verbose=0)
        predicted_class = int(np.argmax(predictions))
        confidence = float(predictions[0][predicted_class])

        return jsonify({
            "predicted_class": label_map.get(predicted_class, "Unknown"),
            "confidence": round(confidence, 4),
        })
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
    finally:
        # Uploaded images are temporary; do not let them pile up on disk.
        filepath.unlink(missing_ok=True)


if __name__ == "__main__":
    # Use the PORT environment variable when provided (Render, Railway, ...).
    port = int(os.environ.get("PORT", 5000))

    # Support production WSGI serving with Waitress on Windows/cross-platform via
    # flag `--waitress` or environment variable `USE_WAITRESS=1`.
    if "--waitress" in sys.argv or os.environ.get("USE_WAITRESS", "").lower() in ("1", "true", "yes"):
        try:
            from waitress import serve
            print(f"Starting Waitress WSGI server on http://0.0.0.0:{port}")
            serve(app, host="0.0.0.0", port=port)
        except ImportError:
            print("Waitress not found. Falling back to Flask built-in server.")
            app.run(host="0.0.0.0", port=port)
    else:
        app.run(host="0.0.0.0", port=port)