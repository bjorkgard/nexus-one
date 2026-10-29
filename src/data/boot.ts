import { registerNexusModule } from "../debug/nexus";
import { liveTransport } from "./live-source";
import { mockTransport, type MockTransport } from "./mock-source";
import { createDataClient, selectSource, type DataClient } from "./source";

// Builds the transport named by `?source=` / `?port=` and starts it. Dev-only hooks drive it.
export function startDataSource(search: string = location.search): DataClient {
  const selection = selectSource(search);
  for (const warning of selection.warnings) console.warn(`[nexus] ${warning}`);
  const mock: MockTransport | null = selection.kind === "mock" ? mockTransport() : null;
  const client = createDataClient(mock ?? liveTransport(selection.port));
  // One internal listener starts the transport; real consumers arrive with the store (4.5).
  client.subscribe(
    () => {},
    () => {},
  );

  const hot = import.meta.hot;
  registerNexusModule(hot, "emit", (event) => client.emit(event));
  registerNexusModule(hot, "setClock", (ts) => {
    if (!mock) throw new Error("setClock needs ?source=mock");
    mock.setClock(ts);
  });
  registerNexusModule(hot, "pauseClock", (paused) => {
    if (!mock) throw new Error("pauseClock needs ?source=mock");
    mock.pauseClock(paused);
  });
  registerNexusModule(hot, "dataState", () => ({
    ...client.stats(),
    source: selection.kind,
    clock: mock ? mock.clock() : null,
  }));
  hot?.dispose(() => client.close());
  return client;
}
