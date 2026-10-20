/* NUS Companion V15 - Firebase Auth bootstrap.
   Important: the app waits for Firebase's FIRST onAuthStateChanged callback
   before deciding whether the user is logged in. This prevents the
   /login.html <-> /index.html redirect loop caused by checking too early.
*/
(function(){
  // Firebase 12.16.0 compat SDK, served with the app (vendor/firebase) so
  // start-up doesn't wait on downloading it.
  const SDK="/vendor/firebase";

  window.nusFirebase={
    configured:false,user:null,error:null,
    async signInGoogle(){throw new Error("Firebase is not configured.");},
    async signInEmail(){throw new Error("Firebase is not configured.");},
    async registerEmail(){throw new Error("Firebase is not configured.");},
    async signOut(){throw new Error("Firebase is not configured.");},
    async saveState(){throw new Error("Firebase is not configured.");},
    async loadState(){return null;},
    async readDoc(){return null;},
    async savePushSubscription(){throw new Error("Firebase is not configured.");},
    async removePushSubscription(){throw new Error("Firebase is not configured.");},
    startStateSync(){return ()=>{};}
  };

  let resolveAuthReady;
  window.nusAuthReady=new Promise(resolve=>{resolveAuthReady=resolve;});

  function valid(c){
    return c && ["apiKey","authDomain","projectId","appId"].every(k=>c[k]) &&
      !Object.values(c).some(v=>String(v).includes("YOUR_"));
  }

  async function getConfig(){
    if(valid(window.NUS_FIREBASE_CONFIG)) return window.NUS_FIREBASE_CONFIG;
    try{
      const r=await fetch("/__/firebase/init.json",{cache:"no-store"});
      if(r.ok){
        const c=await r.json();
        if(valid(c)) return c;
      }
    }catch(e){console.warn("Firebase Hosting config unavailable",e);}
    return null;
  }

  window.nusFirebaseReady=getConfig().then(async config=>{
    if(!config){
      const err=new Error(
        "Firebase Web App configuration was not found. Register a Web App in Firebase Console and deploy this project with Firebase Hosting, or add its config to firebase-config.js."
      );
      window.nusFirebase.error=err;
      resolveAuthReady(null);
      window.dispatchEvent(new CustomEvent("nus-firebase-error",{detail:err}));
      return null;
    }

    try{
      await import(`${SDK}/firebase-app-compat.js`);
      await import(`${SDK}/firebase-auth-compat.js`);
      await import(`${SDK}/firebase-firestore-compat.js`);

      // On Firebase Hosting's *.web.app domain, using the default
      // *.firebaseapp.com authDomain can cause redirect sign-in to lose its
      // auth state on mobile browsers that block third-party storage.
      // Firebase recommends using the domain that actually serves the app.
      // We only override it for Firebase Hosting domains; a custom domain
      // keeps the configured authDomain unless the developer changes it in
      // Firebase Console.
      const host=window.location.hostname;
      const hostingAuthDomain =
        host.endsWith(".web.app") || host.endsWith(".firebaseapp.com")
          ? host
          : null;

      const runtimeConfig={...config};
      if(hostingAuthDomain) runtimeConfig.authDomain=hostingAuthDomain;

      const app=window.firebase.initializeApp(runtimeConfig);
      const auth=app.auth();
      const db=app.firestore();
      // Keep a copy of the data on the device: the app opens with it straight
      // away and syncs in the background. Must run before any other Firestore call.
      try{ await db.enablePersistence({synchronizeTabs:true}); }
      catch(e){ console.warn("Offline cache unavailable",e.code||e); }
      const provider=new window.firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({prompt:"select_account"});

      // Make browser persistence explicit. LOCAL is the default, but being
      // explicit prevents accidental session-only behaviour.
      await auth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);

      // IMPORTANT for mobile redirect sign-in:
      // signInWithRedirect() returns after the browser leaves the page.
      // When the user comes back, getRedirectResult() must be checked
      // explicitly. Relying only on onAuthStateChanged is not sufficient for
      // all mobile browsers.
      let redirectResult=null;
      let redirectError=null;
      try{
        if(!window.Capacitor?.isNativePlatform?.()) redirectResult=await auth.getRedirectResult();
      }catch(e){
        redirectError=e;
        console.error("Firebase redirect sign-in failed",e);
      }

      const api={
          configured:true,
          app,
          auth,
          db,
          user:null,
          error:null,
          stateListener:null,
        async signInGoogle(){
          const ios=/iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1);

          // iOS browsers, including Brave, are more reliable with the
          // full-page redirect flow than a popup.
          if(ios) return auth.signInWithRedirect(provider);

          try{
            const result=await auth.signInWithPopup(provider);
            api.user=result.user;
            return result.user;
          }catch(e){
            if(["auth/popup-blocked","auth/operation-not-supported-in-this-environment"].includes(e.code)){
              return auth.signInWithRedirect(provider);
            }
            throw e;
          }
        },
        async signInEmail(email,password){
          const result=await auth.signInWithEmailAndPassword(email,password);
          api.user=result.user;
          return result.user;
        },
        async registerEmail(email,password){
          const result=await auth.createUserWithEmailAndPassword(email,password);
          api.user=result.user;
          return result.user;
        },
        async signOut(){return auth.signOut();},
        async saveState(snapshot){
          if(!api.user) throw new Error("You are not signed in.");
          const userRef=db.collection("users").doc(api.user.uid);
          await userRef.set({
            uid:api.user.uid,
            email:api.user.email || null,
            updatedAt:window.firebase.firestore.FieldValue.serverTimestamp()
          },{merge:true});
          await userRef.collection("appState").doc("main").set({
            modules:snapshot.modules||[],
            lessons:snapshot.lessons||[],
            activities:snapshot.activities||[],
            tasks:snapshot.tasks||[],
            places:snapshot.places||[],
            syllabus:snapshot.syllabus||{modules:[]},
            archive:snapshot.archive||[],
            gpa:snapshot.gpa||{suLimit:32},
            commutes:snapshot.commutes||[],
            semester:snapshot.semester||{},
            clientUpdatedAt:Date.now(),
            updatedAt:window.firebase.firestore.FieldValue.serverTimestamp()
          },{merge:true});
        },
        // A document the GitHub Action writes, such as users/{uid}/private/onemap.
        async readDoc(path){
          const snap=await db.doc(path).get();
          return snap.exists?snap.data():null;
        },
        async loadState(){
          if(!api.user)return null;
          const snap=await db.collection("users").doc(api.user.uid).collection("appState").doc("main").get();
          return snap.exists?snap.data():null;
        },
        startStateSync(
          onChange,
          onError
        ){

          // Remove any existing listener first.
          if(api.stateListener){
            api.stateListener();
            api.stateListener=null;
          }

          if(!api.user){
            return ()=>{};
          }

          const reference =
            db
              .collection("users")
              .doc(api.user.uid)
              .collection("appState")
              .doc("main");

          api.stateListener =
            reference.onSnapshot(

              snapshot => {

                if(!snapshot.exists){
                  console.log(
                    "Firestore app state document does not exist yet."
                  );
                  return;
                }

                const remoteState =
                  snapshot.data();

                console.log(
                  "Firestore state changed:",
                  remoteState
                );

                if(typeof onChange === "function"){
                  onChange(remoteState);
                }
              },

              error => {

                console.error(
                  "Firestore realtime sync failed:",
                  error
                );

                if(typeof onError === "function"){
                  onError(error);
                }
              }
            );

          // Return a function that stops the listener.
          return ()=>{

            if(api.stateListener){

              api.stateListener();

              api.stateListener=null;
            }

          };
        },
        async savePushSubscription(subscription){
          if(!api.user) throw new Error("You are not signed in.");
          if(!subscription?.endpoint) throw new Error("Invalid push subscription.");
          const userRef=db.collection("users").doc(api.user.uid);
          await userRef.set({
            uid:api.user.uid,
            email:api.user.email || null,
            updatedAt:window.firebase.firestore.FieldValue.serverTimestamp()
          },{merge:true});
          const bytes=new TextEncoder().encode(subscription.endpoint);
          const digest=await crypto.subtle.digest("SHA-256",bytes);
          const docId=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("");
          await db.collection("users").doc(api.user.uid).collection("pushSubscriptions").doc(docId).set({
            subscription:JSON.parse(JSON.stringify(subscription)),
            updatedAt:window.firebase.firestore.FieldValue.serverTimestamp(),
            userAgent:navigator.userAgent
          },{merge:true});
          return docId;
        },
        async removePushSubscription(subscription){
          if(!api.user || !subscription?.endpoint)return;
          const bytes=new TextEncoder().encode(subscription.endpoint);
          const digest=await crypto.subtle.digest("SHA-256",bytes);
          const docId=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("");
          await db.collection("users").doc(api.user.uid).collection("pushSubscriptions").doc(docId).delete();
        }
      };

      window.nusFirebase=api;

      if(redirectResult?.user){
        api.user=redirectResult.user;
      }
      if(redirectError){
        api.error=redirectError;
        window.dispatchEvent(new CustomEvent("nus-firebase-error",{detail:redirectError}));
      }

      let firstState=true;
      auth.onAuthStateChanged(async user=>{
        api.user=user||null;

        if(firstState){
          firstState=false;
          resolveAuthReady(api.user);
        }

        window.dispatchEvent(new CustomEvent("nus-auth-changed",{detail:api.user}));

        if(user){
          try{
            const remote=await api.loadState();
            window.dispatchEvent(new CustomEvent("nus-cloud-state",{detail:remote}));
          }catch(e){
            console.error("Firestore load failed",e);
            window.dispatchEvent(new CustomEvent("nus-firebase-error",{detail:e}));
          }
        }
      });

      return api;
    }catch(e){
      console.error("Firebase initialisation failed",e);
      window.nusFirebase.error=e;
      resolveAuthReady(null);
      window.dispatchEvent(new CustomEvent("nus-firebase-error",{detail:e}));
      return null;
    }
  });
})();
