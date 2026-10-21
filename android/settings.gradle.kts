// Gravity para Android: un WebView nativo que abre el Gravity que corre en tu compu.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "Gravity"
include(":app")
