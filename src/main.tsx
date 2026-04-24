import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { enableMapSet } from "immer";
import App from "@/App";
import { store } from "@/store";
import "@/styles/global.scss";

// Slices hold Maps (entityDict, domainMap, layout.nodes). Immer needs this
// turned on to draft them.
enableMapSet();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </React.StrictMode>
);
