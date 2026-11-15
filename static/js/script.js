/* ==========================================================================
   MangoLeaf_Y — client-side scanner
   Handles file selection (browse / drag / paste), validation, the /predict
   request, and the four states of the diagnosis panel.
   ========================================================================== */

(function () {
    "use strict";

    var MAX_BYTES = 10 * 1024 * 1024;
    var ALLOWED_MIME = ["image/png", "image/jpeg", "image/gif"];
    var ALLOWED_EXTENSIONS = ["png", "jpg", "jpeg", "gif"];

    var LOADING_MESSAGES = [
        "Preparing the image",
        "Reading the leaf surface",
        "Comparing known patterns",
        "Writing treatment notes"
    ];

    var els = {
        dropzone: document.getElementById("dropzone"),
        dropzoneEmpty: document.getElementById("dropzoneEmpty"),
        imageInput: document.getElementById("imageInput"),
        previewWrap: document.getElementById("previewWrap"),
        previewImage: document.getElementById("previewImage"),
        fileBar: document.getElementById("fileBar"),
        fileName: document.getElementById("fileName"),
        fileSize: document.getElementById("fileSize"),
        clearBtn: document.getElementById("clearBtn"),
        fieldError: document.getElementById("fieldError"),
        predictBtn: document.getElementById("predictBtn"),
        predictLabel: document.querySelector("#predictBtn .btn-label"),
        predictSpinner: document.querySelector("#predictBtn .spinner"),
        resultPanel: document.getElementById("resultPanel"),
        stateIdle: document.getElementById("stateIdle"),
        stateLoading: document.getElementById("stateLoading"),
        stateError: document.getElementById("stateError"),
        stateSuccess: document.getElementById("stateSuccess"),
        loadingText: document.getElementById("loadingText"),
        errorText: document.getElementById("errorText"),
        retryBtn: document.getElementById("retryBtn"),
        statusPill: document.getElementById("statusPill"),
        resultClass: document.getElementById("resultClass"),
        resultName: document.getElementById("resultName"),
        resultDesc: document.getElementById("resultDesc"),
        confidenceValue: document.getElementById("confidenceValue"),
        confidenceFill: document.getElementById("confidenceFill"),
        confidenceTrack: document.querySelector(".confidence-track"),
        confidenceNote: document.getElementById("confidenceNote"),
        treatmentList: document.getElementById("treatmentList"),
        scanAnotherBtn: document.getElementById("scanAnotherBtn")
    };

    var DISEASES = {
        "Anthracnose": {
            type: "Fungal disease",
            desc: "A fungal infection that spreads in warm, humid weather, causing sunken lesions on leaves, twigs and fruit."
        },
        "Bacterial Canker": {
            type: "Bacterial disease",
            desc: "A bacterial infection that raises corky lesions, often with a yellow halo, and can wilt young shoots."
        },
        "Cutting Weevil": {
            type: "Pest damage",
            desc: "Damage caused by adult weevils feeding on leaf margins, leaving characteristic notches and ragged edges."
        },
        "Die Back": {
            type: "Fungal disease",
            desc: "A decline starting at the shoot tips, where branches brown, dry out and die progressively downward."
        },
        "Gall Midge": {
            type: "Pest damage",
            desc: "Tiny midge larvae irritate leaf tissue into blister-like galls, distorting new growth and reducing vigour."
        },
        "Healthy": {
            type: "Healthy leaf",
            desc: "No disease patterns were detected. The leaf appears uniform, green and free of visible lesions."
        },
        "Powdery Mildew": {
            type: "Fungal disease",
            desc: "A surface fungus that coats leaves in a white, powdery layer, reducing photosynthesis and plant vigour."
        },
        "Sooty Mould": {
            type: "Fungal disease",
            desc: "A black sooty film that grows on honeydew from sap-sucking insects, blocking light from the leaf."
        }
    };

    var suggestionsMap = {
        "Anthracnose": [
            "Apply a copper-based fungicide to protect leaves and fruit.",
            "Avoid overhead watering to keep leaf surfaces dry.",
            "Remove and destroy infected leaves and fallen fruit."
        ],
        "Bacterial Canker": [
            "Use copper-based sprays to slow the infection.",
            "Avoid excessive water around the root zone.",
            "Prune infected branches during dry weather with clean tools."
        ],
        "Cutting Weevil": [
            "Prune and destroy heavily damaged shoots.",
            "Apply an appropriate insecticide such as spinosad.",
            "Keep the orchard weed-free and monitor feeding at night."
        ],
        "Die Back": [
            "Prune affected branches back to healthy wood with sanitized tools.",
            "Apply a copper or carbendazim fungicide as directed.",
            "Check soil drainage and avoid waterlogging around the tree."
        ],
        "Gall Midge": [
            "Remove and destroy galls before larvae emerge.",
            "Encourage natural predators such as parasitic wasps.",
            "Use a systemic insecticide early in the flush if pressure is high."
        ],
        "Healthy": [
            "Keep watering deeply and less often to encourage strong roots.",
            "Check new growth weekly for the first signs of spots or curling.",
            "Maintain good airflow by thinning dense inner branches."
        ],
        "Powdery Mildew": [
            "Apply a sulfur-based fungicide at the first sign of patches.",
            "Prune to improve airflow through the canopy.",
            "Avoid overhead watering and keep foliage dry overnight."
        ],
        "Sooty Mould": [
            "Control the sap-sucking insects that produce honeydew.",
            "Wash affected leaves with a mild soap solution.",
            "Follow up with neem oil or insecticidal soap."
        ]
    };

    var currentFile = null;
    var previewUrl = null;
    var isBusy = false;
    var loadingTimer = null;
    var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    /* ---------- Helpers ---------- */

    function formatBytes(bytes) {
        if (!bytes) return "0 KB";
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
        return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    }

    // Pasted screenshots occasionally arrive without a filename extension.
    // The API validates extensions, so add one based on the detected MIME type.
    function uploadName(file) {
        var name = file.name || "leaf";
        if (name.indexOf(".") !== -1) return name;
        var extension = file.type === "image/png" ? "png" : file.type === "image/gif" ? "gif" : "jpg";
        return name + "." + extension;
    }

    function validateFile(file) {
        if (!file) return "No file selected. Choose a photo of a mango leaf.";
        if (file.size === 0) return "That file looks empty. Try another photo.";

        var name = (file.name || "").toLowerCase();
        var extensionOk = ALLOWED_EXTENSIONS.some(function (ext) {
            return name.endsWith("." + ext);
        });
        var typeOk = ALLOWED_MIME.indexOf(file.type) !== -1;

        if (!typeOk && !extensionOk) {
            return "That file type isn't supported. Use a JPG, PNG or GIF image.";
        }
        if (file.size > MAX_BYTES) {
            return "That photo is " + formatBytes(file.size) + ". The limit is 10 MB.";
        }
        return null;
    }

    function showFieldError(message) {
        els.fieldError.textContent = message;
        els.fieldError.hidden = false;
    }

    function hideFieldError() {
        els.fieldError.hidden = true;
        els.fieldError.textContent = "";
    }

    function setState(state) {
        els.resultPanel.dataset.state = state;
        els.stateIdle.hidden = state !== "idle";
        els.stateLoading.hidden = state !== "loading";
        els.stateError.hidden = state !== "error";
        els.stateSuccess.hidden = state !== "success";
        els.resultPanel.setAttribute("aria-busy", state === "loading" ? "true" : "false");
    }

    function resetResult() {
        setState("idle");
        els.resultPanel.dataset.status = "none";
        els.confidenceFill.style.width = "0%";
        els.confidenceValue.textContent = "0%";
        els.confidenceTrack.setAttribute("aria-valuenow", "0");
        els.treatmentList.replaceChildren();
    }

    function scrollToElement(element, offset) {
        var top = element.getBoundingClientRect().top + window.scrollY - (offset || 0);
        window.scrollTo({
            top: Math.max(0, top),
            behavior: reducedMotion.matches ? "auto" : "smooth"
        });
    }

    function setBusy(busy) {
        isBusy = busy;
        els.predictSpinner.hidden = !busy;
        els.predictLabel.textContent = busy ? "Analyzing…" : "Analyze leaf";
        els.predictBtn.disabled = busy || !currentFile;
        els.clearBtn.disabled = busy;
        els.dropzone.setAttribute("aria-disabled", busy ? "true" : "false");
    }

    function startLoadingMessages() {
        var index = 0;
        els.loadingText.textContent = LOADING_MESSAGES[0];
        window.clearInterval(loadingTimer);
        loadingTimer = window.setInterval(function () {
            index = Math.min(index + 1, LOADING_MESSAGES.length - 1);
            els.loadingText.textContent = LOADING_MESSAGES[index];
        }, 950);
    }

    function stopLoadingMessages() {
        window.clearInterval(loadingTimer);
        loadingTimer = null;
    }

    function confidenceNote(confidence, isHealthy) {
        if (confidence < 0.6) {
            return isHealthy
                ? "Low confidence — take another evenly lit photo to confirm the leaf is clean."
                : "Low confidence — try a sharper, evenly lit photo of a single leaf.";
        }
        if (isHealthy) {
            return confidence >= 0.85
                ? "High confidence — no disease patterns stand out in this photo."
                : "The leaf looks healthy, though a second angle is always worth a look.";
        }
        if (confidence >= 0.85) return "High confidence — the photo strongly matches this condition.";
        return "Moderate confidence — a second photo from another angle can help confirm.";
    }

    /* ---------- File selection ---------- */

    function selectFile(file) {
        if (isBusy) return;
        hideFieldError();

        var problem = validateFile(file);
        if (problem) {
            showFieldError(problem);
            return;
        }

        currentFile = file;

        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(file);

        els.previewImage.src = previewUrl;
        els.previewImage.alt = "Preview of " + (file.name || "the selected leaf photo");
        els.previewWrap.hidden = false;
        els.dropzoneEmpty.hidden = true;
        els.dropzone.classList.add("has-image");
        els.dropzone.setAttribute("aria-label", "Selected photo. Activate to replace it.");

        els.fileName.textContent = file.name || "leaf photo";
        els.fileSize.textContent = formatBytes(file.size);
        els.fileBar.hidden = false;

        els.predictBtn.disabled = false;
        resetResult();
    }

    function clearFile(options) {
        if (isBusy) return;
        var opts = options || {};

        currentFile = null;
        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
            previewUrl = null;
        }

        els.previewImage.removeAttribute("src");
        els.previewWrap.hidden = true;
        els.dropzoneEmpty.hidden = false;
        els.dropzone.classList.remove("has-image");
        els.dropzone.setAttribute("aria-label", "Upload a mango leaf photo");
        els.fileBar.hidden = true;
        els.fileName.textContent = "";
        els.fileSize.textContent = "";
        els.imageInput.value = "";
        els.predictBtn.disabled = true;
        hideFieldError();

        if (!opts.keepResult) resetResult();
        els.dropzone.focus({ preventScroll: true });
    }

    /* ---------- Result rendering ---------- */

    function renderSuccess(label, rawConfidence) {
        var info = DISEASES[label] || {
            type: "Diagnosis",
            desc: "The model returned this condition for the uploaded leaf."
        };

        var confidence = Math.max(0, Math.min(1, Number(rawConfidence) || 0));
        var percent = Math.round(confidence * 100);
        var isHealthy = label === "Healthy";
        var status = confidence < 0.6 ? "uncertain" : isHealthy ? "healthy" : "attention";

        els.statusPill.textContent = status === "uncertain"
            ? "Low confidence"
            : isHealthy
                ? "Looks healthy"
                : "Attention suggested";

        els.resultClass.textContent = info.type;
        els.resultName.textContent = label;
        els.resultDesc.textContent = info.desc;
        els.confidenceValue.textContent = percent + "%";
        els.confidenceTrack.setAttribute("aria-valuenow", String(percent));
        els.confidenceNote.textContent = confidenceNote(confidence, isHealthy);

        var steps = suggestionsMap[label] || ["No specific guidance is available for this result."];
        els.treatmentList.replaceChildren.apply(
            els.treatmentList,
            steps.map(function (text) {
                var item = document.createElement("li");
                item.textContent = text;
                return item;
            })
        );

        els.resultPanel.dataset.status = status;
        setState("success");

        els.confidenceFill.style.width = "0%";
        window.requestAnimationFrame(function () {
            window.requestAnimationFrame(function () {
                els.confidenceFill.style.width = percent + "%";
            });
        });

        // On narrow screens the diagnosis sits below the uploader, so bring it
        // into view. On desktop, only nudge the page if the panel is off-screen.
        var rect = els.resultPanel.getBoundingClientRect();
        var panelOnScreen = rect.top >= 0 && rect.bottom <= window.innerHeight;
        if (window.matchMedia("(max-width: 900px)").matches || !panelOnScreen) {
            els.resultPanel.scrollIntoView({
                behavior: reducedMotion.matches ? "auto" : "smooth",
                block: "center"
            });
        }
    }

    function renderError(message) {
        els.errorText.textContent = message;
        els.resultPanel.dataset.status = "none";
        setState("error");

        var rect = els.resultPanel.getBoundingClientRect();
        if (window.matchMedia("(max-width: 900px)").matches || rect.top < 0 || rect.bottom > window.innerHeight) {
            els.resultPanel.scrollIntoView({
                behavior: reducedMotion.matches ? "auto" : "smooth",
                block: "center"
            });
        }
    }

    /* ---------- Request ---------- */

    async function analyze() {
        if (!currentFile || isBusy) return;
        hideFieldError();

        setBusy(true);
        setState("loading");
        els.dropzone.classList.add("is-scanning");
        startLoadingMessages();

        var formData = new FormData();
        formData.append("file", currentFile, uploadName(currentFile));

        try {
            var response = await fetch("/predict", {
                method: "POST",
                body: formData,
                headers: { Accept: "application/json" }
            });

            var raw = await response.text();
            var data = {};
            try {
                data = raw ? JSON.parse(raw) : {};
            } catch (parseError) {
                throw new Error("The server returned an unexpected response. Try again in a moment.");
            }

            if (!response.ok) {
                throw new Error(data.error || "The request failed with status " + response.status + ".");
            }
            if (typeof data.predicted_class !== "string" || typeof data.confidence !== "number") {
                throw new Error("The server response was missing a diagnosis.");
            }

            renderSuccess(data.predicted_class, data.confidence);
        } catch (error) {
            renderError(error.message || "Could not reach the server. Check your connection and try again.");
        } finally {
            stopLoadingMessages();
            els.dropzone.classList.remove("is-scanning");
            setBusy(false);
            els.scanAnotherBtn.disabled = false;
        }
    }

    /* ---------- Events: selection ---------- */

    els.dropzone.addEventListener("click", function (event) {
        if (isBusy) return;
        if (event.target === els.imageInput) return;
        els.imageInput.click();
    });

    els.dropzone.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
            event.preventDefault();
            if (!isBusy) els.imageInput.click();
        }
    });

    // Keep the programmatic input click from re-triggering the dropzone handler.
    els.imageInput.addEventListener("click", function (event) {
        event.stopPropagation();
    });

    els.imageInput.addEventListener("change", function (event) {
        var file = event.target.files && event.target.files[0];
        selectFile(file);
        event.target.value = "";
    });

    els.clearBtn.addEventListener("click", function (event) {
        event.stopPropagation();
        clearFile();
    });

    // Drag & drop
    ["dragenter", "dragover"].forEach(function (name) {
        els.dropzone.addEventListener(name, function (event) {
            event.preventDefault();
            event.stopPropagation();
            if (!isBusy) els.dropzone.classList.add("is-dragover");
        });
    });

    ["dragleave", "dragend"].forEach(function (name) {
        els.dropzone.addEventListener(name, function (event) {
            event.preventDefault();
            if (event.relatedTarget && els.dropzone.contains(event.relatedTarget)) return;
            els.dropzone.classList.remove("is-dragover");
        });
    });

    els.dropzone.addEventListener("drop", function (event) {
        event.preventDefault();
        event.stopPropagation();
        els.dropzone.classList.remove("is-dragover");
        var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
        if (file) selectFile(file);
    });

    // Prevent the browser from navigating away when a photo misses the dropzone.
    window.addEventListener("dragover", function (event) {
        event.preventDefault();
    });
    window.addEventListener("drop", function (event) {
        event.preventDefault();
    });

    // Paste a screenshot or copied image anywhere on the page.
    document.addEventListener("paste", function (event) {
        if (isBusy) return;
        var items = event.clipboardData && event.clipboardData.items;
        if (!items) return;

        for (var i = 0; i < items.length; i += 1) {
            if (items[i].type && items[i].type.indexOf("image/") === 0) {
                var file = items[i].getAsFile();
                if (file) {
                    event.preventDefault();
                    selectFile(file);
                }
                break;
            }
        }
    });

    /* ---------- Events: actions ---------- */

    els.predictBtn.addEventListener("click", analyze);
    els.retryBtn.addEventListener("click", analyze);

    els.scanAnotherBtn.addEventListener("click", function () {
        clearFile();
        var scanner = document.getElementById("scan");
        if (scanner) scrollToElement(scanner, 88);
    });

    /* ---------- Field guide category filter ---------- */

    var filterButtons = document.querySelectorAll(".condition-filter .filter-btn");
    var conditionCards = document.querySelectorAll(".condition-grid .condition-card");

    if (filterButtons.length && conditionCards.length) {
        filterButtons.forEach(function (btn) {
            btn.addEventListener("click", function () {
                var filter = btn.dataset.filter;

                filterButtons.forEach(function (b) {
                    var isActive = b === btn;
                    b.classList.toggle("is-active", isActive);
                    b.setAttribute("aria-selected", isActive ? "true" : "false");
                });

                conditionCards.forEach(function (card) {
                    var category = card.dataset.category;
                    var match = filter === "all" || category === filter;
                    card.hidden = !match;
                });
            });
        });
    }

    /* ---------- Individual advisory exclusive toggle ---------- */

    var advisories = document.querySelectorAll(".condition-advisory");
    if (advisories.length) {
        advisories.forEach(function (advisory) {
            advisory.addEventListener("toggle", function () {
                if (advisory.open) {
                    advisories.forEach(function (other) {
                        if (other !== advisory && other.open) {
                            other.open = false;
                        }
                    });
                }
            });
        });
    }
})();
