/* NUS Helper IPA - native Google sign-in.
 * Loaded right after firebase.js. Google blocks its sign-in page inside app
 * web views, so sign in with the native Google SDK and hand the token to the
 * Firebase JS SDK, which keeps doing everything else exactly as on the web.
 */
(function(){
  const cap=window.Capacitor;
  if(!cap?.isNativePlatform?.()) return;
  document.documentElement.classList.add("native-app");

  const FirebaseAuthentication=cap.Plugins.FirebaseAuthentication;

  window.nusFirebaseReady=window.nusFirebaseReady.then(api=>{
    if(!api?.configured) return api;
    const webSignOut=api.signOut.bind(api);

    api.signInGoogle=async()=>{
      const result=await FirebaseAuthentication.signInWithGoogle();
      const idToken=result?.credential?.idToken;
      if(!idToken) throw new Error("Google sign-in did not return a token.");
      const credential=window.firebase.auth.GoogleAuthProvider.credential(idToken,result.credential.accessToken);
      const signedIn=await api.auth.signInWithCredential(credential);
      api.user=signedIn.user;
      return signedIn.user;
    };

    // Also sign out of the native Google session so the account picker
    // appears again next time.
    api.signOut=async()=>{
      try{ await FirebaseAuthentication.signOut(); }catch(e){ console.warn("Native sign-out failed",e); }
      return webSignOut();
    };

    return api;
  });
})();
