import { configureStore } from "@reduxjs/toolkit";
import { useDispatch, useSelector, type TypedUseSelectorHook } from "react-redux";
import addTableReducer from "@/features/addTable/addTableSlice";
import mergeReducer from "@/features/merge/mergeSlice";
import erdReducer from "@/features/erd/erdSlice";

export const store = configureStore({
  reducer: {
    addTable: addTableReducer,
    merge: mergeReducer,
    erd: erdReducer,
  },
  middleware: (getDefault) =>
    getDefault({
      // Slices carry Maps and (indirectly via layout) plain-but-deep objects.
      // Immer is fine with Maps via enableMapSet; we just turn off the
      // serializable check so Redux DevTools doesn't flag them.
      serializableCheck: false,
    }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
