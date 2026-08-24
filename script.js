"use strict";

const touchArea = document.querySelector("#touch-area");
const touchCounter = document.querySelector("#touch-counter");
const activeTouches = new Map();

// Vergibt immer die kleinste aktuell freie sichtbare Nummer.
function getNextFreeNumber() {
  const usedNumbers = new Set(
    Array.from(activeTouches.values(), (touch) => touch.number),
  );
  let number = 1;

  while (usedNumbers.has(number)) {
    number += 1;
  }

  return number;
}

function updateCounter() {
  touchCounter.textContent = `ACTIVE TOUCHES: ${activeTouches.size}`;
}

function moveMarker(marker, touch) {
  marker.style.left = `${touch.clientX}px`;
  marker.style.top = `${touch.clientY}px`;
}

function handleTouchStart(event) {
  event.preventDefault();

  for (const touch of event.changedTouches) {
    if (activeTouches.has(touch.identifier)) {
      continue;
    }

    const number = getNextFreeNumber();
    const marker = document.createElement("div");
    marker.className = "touch-marker";
    marker.textContent = number;
    marker.setAttribute("aria-hidden", "true");
    moveMarker(marker, touch);
    touchArea.append(marker);
    activeTouches.set(touch.identifier, { number, marker });
  }

  updateCounter();
}

function handleTouchMove(event) {
  event.preventDefault();

  for (const touch of event.changedTouches) {
    const activeTouch = activeTouches.get(touch.identifier);

    if (activeTouch) {
      moveMarker(activeTouch.marker, touch);
    }
  }
}

function handleTouchEnd(event) {
  event.preventDefault();

  for (const touch of event.changedTouches) {
    const activeTouch = activeTouches.get(touch.identifier);

    if (activeTouch) {
      activeTouch.marker.remove();
      activeTouches.delete(touch.identifier);
    }
  }

  updateCounter();
}

// passive: false ist nötig, damit preventDefault Scrollen und Zoom unterbindet.
touchArea.addEventListener("touchstart", handleTouchStart, { passive: false });
touchArea.addEventListener("touchmove", handleTouchMove, { passive: false });
touchArea.addEventListener("touchend", handleTouchEnd, { passive: false });
touchArea.addEventListener("touchcancel", handleTouchEnd, { passive: false });

// Zusätzliche iOS-Schutzmaßnahmen gegen Gestenmenü und Pinch-Zoom.
document.addEventListener("gesturestart", (event) => event.preventDefault());
document.addEventListener("contextmenu", (event) => event.preventDefault());
