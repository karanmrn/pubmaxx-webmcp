"use client";

import { useCallback, useEffect, useRef } from "react";

import {
  DEPLOYMENT_SKEW_CHECK_EVENT,
  fetchCurrentDeploymentId,
  getClientDeploymentId,
  getSessionStorage,
  hasUnsavedUserInput,
  recoverDeploymentSkew,
} from "@/lib/deploymentSkewRecovery";
import { useReconnectRecovery } from "@/lib/useReconnectRecovery";

const DEPLOYMENT_RECOVERY_EVENTS = ["visible", "pageshow"] as const;

export default function DeploymentSkewRecovery(): null {
  const checkingRef = useRef(false);
  const checkDeployment = useCallback(() => {
    if (checkingRef.current) return;
    const clientDeploymentId = getClientDeploymentId();
    if (!clientDeploymentId) return;

    checkingRef.current = true;
    void fetchCurrentDeploymentId().then((currentDeploymentId) => {
      recoverDeploymentSkew({
        clientDeploymentId,
        currentDeploymentId,
        storage: getSessionStorage(),
        isDirty: () => hasUnsavedUserInput(document),
        reload: () => window.location.reload(),
      });
    }).finally(() => {
      checkingRef.current = false;
    });
  }, []);

  useReconnectRecovery(true, checkDeployment, {
    debounceMs: 0,
    events: DEPLOYMENT_RECOVERY_EVENTS,
  });

  // A failed lazy chunk asks for the same check without waiting for a wake
  // (lib/deploymentSkewRecovery.ts). The guards below it are unchanged: one
  // reload per deployment id, and never over unsaved input.
  useEffect(() => {
    const onCheck = () => checkDeployment();
    window.addEventListener(DEPLOYMENT_SKEW_CHECK_EVENT, onCheck);
    return () => window.removeEventListener(DEPLOYMENT_SKEW_CHECK_EVENT, onCheck);
  }, [checkDeployment]);

  return null;
}
