export const SettingsDesignLab = () => {
    console.log("SettingsDesignLab MOUNTED");
    return (
        <div className="w-full h-full min-h-[500px] bg-red-500 text-white p-20 z-[9999] relative flex flex-col items-center justify-center">
            <h1 className="text-4xl font-bold mb-4">DEBUG MODE</h1>
            <p className="text-xl">If you can read this, the route is working.</p>
            <p className="mt-4 opacity-80">Location: /settings-lab</p>
        </div>
    );
};
