import { createContext, useCallback, useContext, useState } from "react";
import { getAt } from "./workspace-model.js";
import { tournamentHeaders } from "./tournament-context.js";
export const WorkspaceContext = createContext(null);
export const useWorkspace = () => useContext(WorkspaceContext);
export function useWorkspaceField(path, initial) {
  const shared = useWorkspace();
  const [local, setLocal] = useState(initial);
  const key = JSON.stringify(path),
    update = shared?.update;
  const set = useCallback(
    (value) => {
      if (update) update(JSON.parse(key), value);
      else setLocal(value);
    },
    [key, update],
  );
  return [shared ? (getAt(shared.data, path) ?? initial) : local, set];
}
export async function workspaceRequest(path, value) {
  const response = await fetch(`/api/${path}`, {
    ...(value === undefined
      ? {}
      : {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...tournamentHeaders(),
          },
          body: JSON.stringify(value),
        }),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.workspace = data.workspace;
    throw error;
  }
  return data;
}
