document.addEventListener("DOMContentLoaded",async()=>{
  const errorBox=document.getElementById("authError");
  const google=document.getElementById("googleBtn");
  const form=document.getElementById("emailForm");
  const login=document.getElementById("emailLoginBtn");
  const register=document.getElementById("registerBtn");

  let redirected=false;

  const goToApp=()=>{
    if(redirected)return;
    redirected=true;
    // assign is intentional here: it forces a fresh protected-page load
    // after Firebase has restored the authenticated session.
    window.location.assign("/index.html");
  };

  const showError=e=>{
    const code=e?.code||"";
    const messages={
      "auth/invalid-credential":"Incorrect email or password.",
      "auth/invalid-email":"Please enter a valid email address.",
      "auth/email-already-in-use":"An account already exists for this email. Try logging in instead.",
      "auth/weak-password":"Password must be at least 6 characters.",
      "auth/operation-not-allowed":"This sign-in method is not enabled in Firebase Authentication.",
      "auth/unauthorized-domain":"This website is not authorised in Firebase Authentication. Add your Firebase Hosting domain under Authentication → Settings → Authorised domains.",
      "auth/popup-blocked":"Google popup was blocked. Allow popups or try again.",
      "auth/popup-closed-by-user":"Google sign-in was cancelled.",
      "auth/network-request-failed":"Network connection to Firebase failed.",
      "auth/redirect-cancelled-by-user":"Google sign-in was cancelled.",
      "auth/invalid-credential":"Google sign-in could not be completed. Please try again.",
      "auth/internal-error":"Firebase could not complete Google sign-in. Check the Firebase Auth domain configuration."
    };
    errorBox.textContent=messages[code]||e?.message||"Authentication failed. Please try again.";
    errorBox.classList.remove("hidden");
  };

  const setBusy=(busy,text)=>{
    [google,login,register].forEach(b=>b.disabled=busy);
    if(busy) login.textContent=text||"Please wait…";
    else login.textContent="Log in with email";
  };

  // This is intentionally independent of the promise resolution timing.
  // If Firebase announces a user at any point, leave the login page.
  window.addEventListener("nus-auth-changed",e=>{
    if(e.detail) goToApp();
  });

  window.addEventListener("nus-firebase-error",e=>showError(e.detail));

  try{
    // Firebase initialization now includes getRedirectResult(), so wait for
    // that operation before deciding that the user is unauthenticated.
    const api=await window.nusFirebaseReady;

    if(api?.error){
      showError(api.error);
    }

    if(api?.user || api?.auth?.currentUser){
      goToApp();
      return;
    }

    const user=await window.nusAuthReady;
    if(user || window.nusFirebase?.auth?.currentUser){
      goToApp();
      return;
    }
  }catch(e){
    console.error("Login initialisation failed",e);
    showError(e);
  }

  // Safety net for browsers where IndexedDB/Auth persistence finishes after
  // the first page lifecycle event. This prevents the "works after refresh"
  // behaviour without creating a redirect loop.
  const poll=setInterval(()=>{
    const user=window.nusFirebase?.user || window.nusFirebase?.auth?.currentUser;
    if(user){
      clearInterval(poll);
      goToApp();
    }
  },250);
  setTimeout(()=>clearInterval(poll),10000);

  google.onclick=async()=>{
    errorBox.classList.add("hidden");
    google.disabled=true;
    google.textContent="Opening Google…";
    try{
      await window.nusFirebase.signInGoogle();
      const user=window.nusFirebase?.user || window.nusFirebase?.auth?.currentUser;
      if(user)goToApp();
    }catch(e){
      console.error("Google sign-in error",e);
      showError(e);
      google.disabled=false;
      google.innerHTML='<span class="google-icon">G</span> Continue with Google';
    }
  };

  form.onsubmit=async e=>{
    e.preventDefault();
    errorBox.classList.add("hidden");
    setBusy(true,"Logging in…");
    try{
      await window.nusFirebase.signInEmail(
        document.getElementById("email").value.trim(),
        document.getElementById("password").value
      );
      goToApp();
    }catch(err){
      showError(err);
      setBusy(false);
    }
  };

  register.onclick=async()=>{
    errorBox.classList.add("hidden");
    setBusy(true,"Creating account…");
    try{
      await window.nusFirebase.registerEmail(
        document.getElementById("email").value.trim(),
        document.getElementById("password").value
      );
      goToApp();
    }catch(err){
      showError(err);
      setBusy(false);
    }
  };
});
