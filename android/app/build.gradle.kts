plugins {
    id("com.android.application")
}

// En la CI cada compilación sube el número de versión, así una APK nueva se instala encima de la anterior.
val numeroDeCompilacion = providers.environmentVariable("GITHUB_RUN_NUMBER").orNull?.toIntOrNull() ?: 1

// Firma de la versión release: solo si la CI dejó la keystore (secretos del repo). Si no, se usa la APK debug.
val rutaKeystore = providers.environmentVariable("ANDROID_KEYSTORE_PATH").orNull

android {
    namespace = "ar.gravity.app"
    compileSdk = 37

    defaultConfig {
        applicationId = "ar.gravity.app"
        minSdk = 26
        // 36 a propósito, NO 37: con targetSdk 37, Android 17 bloquea la red local (192.168.x.x) hasta que
        // el usuario acepte el permiso de ejecución ACCESS_LOCAL_NETWORK ("dispositivos cercanos"), y el
        // WebView hereda ese bloqueo: la conexión por Wi-Fi quedaría colgada hasta dar timeout.
        // Para subir a 37 hay que declarar y pedir ese permiso antes de cargar una dirección local.
        targetSdk = 36
        versionCode = numeroDeCompilacion
        versionName = "1.0.$numeroDeCompilacion"
    }

    signingConfigs {
        if (rutaKeystore != null) {
            create("gravity") {
                storeFile = file(rutaKeystore)
                storePassword = providers.environmentVariable("ANDROID_KEYSTORE_PASSWORD").orNull
                keyAlias = providers.environmentVariable("ANDROID_KEY_ALIAS").orNull
                keyPassword = providers.environmentVariable("ANDROID_KEY_PASSWORD").orNull
            }
        }
    }

    buildTypes {
        getByName("release") {
            if (rutaKeystore != null) {
                signingConfig = signingConfigs.getByName("gravity")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        // La CI solo arma la APK; lint se corre a mano con `gradle lint`.
        checkReleaseBuilds = false
    }
}

dependencies {
    // Sin AndroidX ni otras librerías: solo el framework de Android y la biblioteca estándar de Kotlin.
    implementation("org.jetbrains.kotlin:kotlin-stdlib:2.4.21")
}
