import { Redirect } from "expo-router";
import { DEV_ROLE } from "../src/constants/devRole";

export default function Index() {
  return <Redirect href={DEV_ROLE === "officer" ? "/officer/home" : "/user/home"} />;
}
