import React from "react";
import { CloseAccountScreen } from "../../src/auth/AccountScreens";
import { useApp } from "../../src/context/AppContext";

// Close account (citizen). The reward balance shown is what will be forfeited.
export default function DeleteAccount() {
  const { walletAvailable, walletPending } = useApp();
  const total = walletAvailable + walletPending;
  return <CloseAccountScreen rewardBalanceEuros={total > 0 ? `€${total.toFixed(2)}` : null} />;
}
