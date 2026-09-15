"use strict";

(function installTeamDivisionV2Logic(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.TeamSplitterV2Logic = api;
})(typeof window !== "undefined" ? window : null, () => {
  function getParticipantOverview(selectedParticipants, assignmentEntries, hasAutoSplitContext) {
    const assignedIds = new Set(assignmentEntries.map(({ participantId }) => participantId));
    return selectedParticipants
      .map((participant, selectionIndex) => ({
        participant,
        participantId: participant.id,
        name: participant.name,
        isAssigned: assignedIds.has(participant.id),
        isMissing: Boolean(hasAutoSplitContext && !assignedIds.has(participant.id)),
        selectionIndex,
      }))
      .sort((a, b) => Number(b.isMissing) - Number(a.isMissing) || a.selectionIndex - b.selectionIndex);
  }

  function getPrimarySplitAction(participantOverview, hasAutomaticAssignments) {
    const missing = participantOverview.filter(({ isMissing }) => isMissing).map(({ participant }) => participant);
    if (missing.length) return { kind: "missing", label: missing.length === 1 ? "Fehlenden Spieler zuteilen" : "Fehlende Spieler aufteilen", participants: missing };
    const unassigned = participantOverview.filter(({ isAssigned }) => !isAssigned).map(({ participant }) => participant);
    if (!unassigned.length && participantOverview.length && hasAutomaticAssignments) return { kind: "reshuffle", label: "Neu aufteilen", participants: [] };
    return { kind: "split", label: "Aufteilen", participants: unassigned };
  }

  function shuffleWith(items, randomInt) {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const randomIndex = randomInt(index + 1);
      [result[index], result[randomIndex]] = [result[randomIndex], result[index]];
    }
    return result;
  }

  function createFairAutomaticAssignments({ participants, manualAssignments, initialAutomaticAssignments = [], teamCount, randomInt }) {
    const assignments = Array.from({ length: teamCount }, (_, index) => [...(initialAutomaticAssignments[index] ?? [])]);
    const teamSizes = Array.from({ length: teamCount }, (_, index) => (manualAssignments[index]?.length ?? 0) + assignments[index].length);
    for (const participant of shuffleWith(participants, randomInt)) {
      const smallest = Math.min(...teamSizes);
      const choices = teamSizes.flatMap((size, index) => size === smallest ? [index] : []);
      const teamIndex = choices[randomInt(choices.length)];
      assignments[teamIndex].push(participant);
      teamSizes[teamIndex] += 1;
    }
    return assignments;
  }

  function getAutomaticAssignmentSignature(assignments) {
    return assignments.flatMap((members, teamIndex) => members.map(({ id }) => `${id}:${teamIndex}`)).sort().join("|");
  }

  function ensureDifferentFairAssignment(assignments, previousSignature) {
    if (getAutomaticAssignmentSignature(assignments) !== previousSignature) return assignments;
    const alternative = assignments.map((members) => [...members]);
    const populatedTeams = alternative.flatMap((members, teamIndex) => members.length ? [teamIndex] : []);
    for (let left = 0; left < populatedTeams.length; left += 1) {
      for (let right = left + 1; right < populatedTeams.length; right += 1) {
        const a = populatedTeams[left];
        const b = populatedTeams[right];
        [alternative[a][0], alternative[b][0]] = [alternative[b][0], alternative[a][0]];
        if (getAutomaticAssignmentSignature(alternative) !== previousSignature) return alternative;
        [alternative[a][0], alternative[b][0]] = [alternative[b][0], alternative[a][0]];
      }
    }
    return assignments;
  }

  function createReshuffledAutomaticAssignments({ participants, manualAssignments, previousAssignments, teamCount, randomInt, maxAttempts = 8 }) {
    const previousSignature = getAutomaticAssignmentSignature(previousAssignments);
    let assignments = [];
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      assignments = createFairAutomaticAssignments({ participants, manualAssignments, teamCount, randomInt });
      if (getAutomaticAssignmentSignature(assignments) !== previousSignature) return assignments;
    }
    return ensureDifferentFairAssignment(assignments, previousSignature);
  }

  function splitWheelLabel(name, maxCharacters) {
    const words = name.split(/\s+/).filter(Boolean);
    if (name.length <= maxCharacters) return [name];
    if (words.length === 1) {
      const middle = Math.ceil(name.length / 2);
      return [name.slice(0, middle), name.slice(middle)];
    }
    let best = [words[0], words.slice(1).join(" ")];
    let bestScore = Infinity;
    for (let index = 1; index < words.length; index += 1) {
      const lines = [words.slice(0, index).join(" "), words.slice(index).join(" ")];
      const score = Math.max(...lines.map((line) => line.length)) * 2 + Math.abs(lines[0].length - lines[1].length);
      if (score < bestScore) { best = lines; bestScore = score; }
    }
    return best;
  }

  function getWheelLabelLayout(teamName, segmentAngle, teamCount) {
    const name = String(teamName ?? "").trim().replace(/\s+/g, " ");
    const angle = Math.max(1, Number(segmentAngle) || (360 / Math.max(1, teamCount)));
    const chordWidth = 2 * 94 * Math.sin(Math.min(180, angle) * Math.PI / 360);
    const width = Math.round(Math.max(72, Math.min(150, chordWidth)));
    const maxCharacters = Math.max(8, Math.floor(width / (teamCount >= 6 ? 6.2 : 7)));
    const lines = splitWheelLabel(name, maxCharacters);
    const longestLine = Math.max(1, ...lines.map((line) => line.length));
    const maximumFontSize = teamCount <= 3 ? 13 : teamCount <= 4 ? 12 : 11;
    const fontSize = Math.max(8, Math.min(maximumFontSize, Math.floor(width / (longestLine * 0.62))));
    return Object.freeze({ lines: Object.freeze(lines), width, fontSize, radialOffset: teamCount >= 6 ? 105 : 108 });
  }

  return Object.freeze({ getParticipantOverview, getPrimarySplitAction, createFairAutomaticAssignments, createReshuffledAutomaticAssignments, getAutomaticAssignmentSignature, ensureDifferentFairAssignment, getWheelLabelLayout });
});
